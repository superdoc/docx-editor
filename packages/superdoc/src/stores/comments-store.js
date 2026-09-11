import { defineStore } from 'pinia';
import { ref, shallowRef, reactive, computed, watch, toRaw } from 'vue';
import { comments_module_events } from '@superdoc/common';
import { useSuperdocStore } from '@superdoc/stores/superdoc-store';
import { syncCommentsToClients } from '../core/collaboration/helpers.js';
import useComment, { COMMENT_RECONCILIATION_TOKEN } from '@superdoc/components/CommentsLayer/use-comment';
import { groupChanges } from '../helpers/group-changes.js';
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

class Editor {
  constructor() {
    throw new Error('SuperDoc v2 beta: v1 editor-backed comment import paths are not available.');
  }
}

const trackChangesHelpers = {
  getTrackChanges: () => [],
  enumerateStructuralRowChanges: () => [],
};

const CommentsPluginKey = Symbol('comments-plugin-disabled');
const getRichTextExtensions = () => [];
const createOrUpdateTrackedChangeComment = () => null;
const getTrackedChangeIndex = () => null;
const resolveTrackedChangeInStory = () => null;
const makeTrackedChangeAnchorKey = ({ storyKey, rawId }) => `tc::${storyKey}::${rawId}`;
const COMMENT_DRAFT_BR_TAG = /<br(?:\s[^>]*)?\s*\/?>/gi;
const COMMENT_DRAFT_BLOCK_OPEN_TAG = /<(?:p|div|li|blockquote|pre|h[1-6])(?:\s[^>]*)?\s*\/?>/gi;
const COMMENT_DRAFT_BLOCK_CLOSE_TAG = /<\/(?:p|div|li|blockquote|pre|h[1-6])\s*>/gi;
const COMMENT_DRAFT_ANY_TAG = /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^>]*)?\s*\/?>/g;
const COMMENT_DRAFT_ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g;
const COMMENT_DRAFT_NAMED_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};
const shallowEqual = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]));
};

/**
 * Normalize the optional signed tracked-change detail lines
 * (`[{ excerpt, label }]`, TCS-LIST-005) to a stable shape; absent, empty, or
 * malformed input reads as `null` so legacy rows stay untouched.
 */
const normalizeTrackedChangeDetailLines = (lines) => {
  if (!Array.isArray(lines)) return null;
  const normalized = lines
    .filter((line) => line && typeof line === 'object')
    .map((line) => ({
      excerpt: typeof line.excerpt === 'string' ? line.excerpt : '',
      label: typeof line.label === 'string' ? line.label : '',
    }));
  return normalized.length > 0 ? normalized : null;
};

/**
 * Element-wise equality for detail-line arrays: refresh paths rebuild the
 * array each pass, so reference equality would rebroadcast every keystroke.
 */
const trackedChangeDetailLinesEqual = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((line, index) => shallowEqual(line, b[index]));
};

const normalizeTrackedChangeCustomAttributes = (attributes) => {
  if (!Array.isArray(attributes)) return null;
  return attributes
    .filter((attribute) => attribute && typeof attribute === 'object')
    .map((attribute) => ({
      name: typeof attribute.name === 'string' ? attribute.name : '',
      namespaceUri: typeof attribute.namespaceUri === 'string' ? attribute.namespaceUri : '',
      localName: typeof attribute.localName === 'string' ? attribute.localName : '',
      value: typeof attribute.value === 'string' ? attribute.value : '',
    }))
    .filter((attribute) => attribute.name && attribute.namespaceUri && attribute.localName);
};

const trackedChangeCustomAttributesEqual = (left, right) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((attribute, index) => shallowEqual(attribute, right[index]));
};

const normalizeTrackedChangeImagePreview = (preview) => {
  if (!preview || typeof preview !== 'object') return null;
  const src = typeof preview.src === 'string' ? preview.src : null;
  if (!src || !src.startsWith('data:image/')) return null;
  const contentType =
    typeof preview.contentType === 'string' && preview.contentType.startsWith('image/') ? preview.contentType : null;
  const role = typeof preview.role === 'string' ? preview.role : null;
  const width =
    typeof preview.width === 'number' && Number.isFinite(preview.width) && preview.width > 0 ? preview.width : null;
  const height =
    typeof preview.height === 'number' && Number.isFinite(preview.height) && preview.height > 0 ? preview.height : null;
  const alt = typeof preview.alt === 'string' && preview.alt.length > 0 ? preview.alt : 'Tracked image preview';
  return {
    src,
    ...(contentType ? { contentType } : {}),
    ...(role ? { role } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    alt,
  };
};

const decodeCommentDraftEntity = (entity) => {
  const lower = String(entity).toLowerCase();
  const named = COMMENT_DRAFT_NAMED_ENTITIES[lower];
  if (named !== undefined) return named;
  const radix = lower.startsWith('#x') ? 16 : lower.startsWith('#') ? 10 : null;
  if (!radix) return null;
  const value = lower.startsWith('#x') ? lower.slice(2) : lower.slice(1);
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isFinite(codePoint)) return null;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return null;
  }
};

const decodeCommentDraftEntities = (value) =>
  value.replace(COMMENT_DRAFT_ENTITY, (match, entity) => decodeCommentDraftEntity(entity) ?? match);

const normalizeV2CommentDraftText = (value) => {
  const html = String(value ?? '');
  if (!html || html === '<p></p>') return '';
  return decodeCommentDraftEntities(
    html
      .replace(COMMENT_DRAFT_BR_TAG, '\n')
      .replace(COMMENT_DRAFT_BLOCK_CLOSE_TAG, '\n')
      .replace(COMMENT_DRAFT_BLOCK_OPEN_TAG, '')
      .replace(COMMENT_DRAFT_ANY_TAG, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
};

const cloneV2TrackedChangeStory = (story) => {
  if (!story || typeof story !== 'object') return null;
  const rawStory = toRaw(story);
  return {
    ...rawStory,
    ...(rawStory.section && typeof rawStory.section === 'object' ? { section: { ...toRaw(rawStory.section) } } : {}),
  };
};

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

  /**
   * Compute the stable public id for a structural (whole-table) tracked change.
   *
   * This MUST match the public id the document-api projects for the same change
   * (`tracked-change-resolver.groupTrackedChanges`), otherwise the right-rail
   * accept/reject would route `trackChanges.decide` to a change that does not
   * exist. The doc-api derives the public id as `word:structural:<sourceId>`
   * for imported Word revisions, falling back to the per-import logical id.
   * Reuse the exact rule here so the bubble id is the decide id.
   *
   * @param {{ sourceId?: string, id?: string }} structural
   * @returns {string | null}
   */
  const buildStructuralTrackedChangeId = (structural) => {
    if (!structural) return null;
    const sourceId = structural.sourceId ? String(structural.sourceId) : '';
    if (sourceId) return `word:structural:${sourceId}`;
    return structural.id ? String(structural.id) : null;
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

  const isDebugging = false;
  const debounceTimers = {};
  const trackedChangeResolutionSnapshots = new WeakMap();
  const importedTrackedChangeBootstrapTasks = new Map();
  let importedTrackedChangeBootstrapGeneration = 0;

  const isBenchmarkCommentsDebugEnabled = () => {
    if (isDebugging) return true;
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
  const hasInitializedComments = ref(false);
  const hasSyncedCollaborationComments = ref(false);
  const commentsParentElement = ref(null);
  const hasInitializedLocations = ref(false);
  const activeComment = ref(null);
  const activeFloatingCommentInstanceId = ref(null);
  const editingCommentId = ref(null);
  const commentDialogs = ref([]);
  const overlappingComments = ref([]);
  const overlappedIds = new Set([]);
  const suppressInternalExternal = ref(true);
  const currentCommentText = ref('');
  const currentCommentMentions = ref([]);
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
  const sortedConversations = ref([]);
  const visibleConversations = ref([]);
  const skipSelectionUpdate = ref(false);
  const isFloatingCommentsReady = ref(false);
  const generalCommentIds = ref([]);
  const instantSidebarAlignmentTargetY = ref(null);
  const instantSidebarAlignmentThreadId = ref(null);
  const instantSidebarAlignmentInstanceId = ref(null);

  const pendingComment = ref(null);
  const pendingV2CommentTarget = shallowRef(null);
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

  const getPositionEntryByAlias = (id) => {
    const normalizedId = normalizeCommentId(id);
    if (!normalizedId) return { key: null, entry: null };

    const positions = editorCommentPositions.value || {};
    if (positions[normalizedId] !== undefined) {
      return { key: normalizedId, entry: positions[normalizedId] };
    }

    for (const [key, entry] of Object.entries(positions)) {
      const entryKey = normalizeCommentId(entry?.key);
      const threadId = normalizeCommentId(entry?.threadId);
      if (entryKey === normalizedId || threadId === normalizedId) {
        return { key, entry };
      }
    }

    return { key: null, entry: null };
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
    return (
      findIn(commentsList.value) ?? findIn(reviewDirectoryList.value) ?? getTrackedChangeCommentByPositionAlias(id)
    );
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

  const restoreResolvedMetadata = (comment) => {
    if (!comment) return false;
    const snapshot = trackedChangeResolutionSnapshots.get(comment);
    if (!snapshot) return false;

    comment.resolvedTime = snapshot.resolvedTime ?? Date.now();
    comment.resolvedById = snapshot.resolvedById ?? null;
    comment.resolvedByEmail = snapshot.resolvedByEmail ?? null;
    comment.resolvedByName = snapshot.resolvedByName ?? null;
    comment.trackedChangeDecision = snapshot.trackedChangeDecision ?? null;
    return true;
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

  const syncTrackedChangePositionsWithDocument = ({ documentId, editor } = {}) => {
    // Keep editor-driven comment anchors in sync with live tracked-change marks
    if (!editor?.state) return 0;
    if (!commentsList.value?.length) return 0;

    const currentPositions = editorCommentPositions.value || {};
    if (!Object.keys(currentPositions).length) return 0;

    // Which position key is currently in use (first alias present in currentPositions)
    const resolveExistingPositionKey = (aliasIds) =>
      aliasIds.find((key) => currentPositions[key] !== undefined) ?? null;

    // First pass: find tracked-change root comments that still have positions in this document
    const candidateRootPositionKeys = new Set();
    const rootAliasesByPositionKey = new Map();

    commentsList.value.forEach((comment) => {
      if (!comment?.trackedChange) return;
      if (documentId) {
        const resolvedDocumentId = comment?.fileId ?? null;
        if (resolvedDocumentId && resolvedDocumentId !== documentId) return;
      }

      const aliasIds = getCommentAliasIds(comment);
      const normalizedPositionKey = resolveExistingPositionKey(aliasIds);
      if (!normalizedPositionKey) return;

      candidateRootPositionKeys.add(normalizedPositionKey);
      rootAliasesByPositionKey.set(normalizedPositionKey, new Set(aliasIds));
    });

    if (!candidateRootPositionKeys.size) return 0;

    // Collect IDs for all currently active tracked-change marks in the document
    const trackedIds = new Set(
      trackChangesHelpers
        .getTrackChanges(editor.state)
        .map(({ mark }) => mark?.attrs?.id)
        .filter((id) => id !== undefined && id !== null)
        .map((id) => String(id)),
    );
    const trackedChangeIndex = typeof getTrackedChangeIndex === 'function' ? getTrackedChangeIndex(editor) : null;
    let liveAnchorKeySource = [];
    try {
      liveAnchorKeySource = trackedChangeIndex?.getAll?.() ?? [];
    } catch {}
    const liveAnchorKeys = new Set(
      liveAnchorKeySource
        .map((snapshot) => snapshot?.anchorKey)
        .filter((anchorKey) => typeof anchorKey === 'string' && anchorKey.length > 0),
    );
    // Any tracked-change roots whose aliases are missing from document marks are considered stale
    const staleRootPositionKeys = new Set(
      Array.from(candidateRootPositionKeys).filter((positionKey) => {
        const aliases = rootAliasesByPositionKey.get(positionKey) ?? new Set([positionKey]);
        const hasLiveAnchorKey = Array.from(aliases).some((alias) => liveAnchorKeys.has(alias));
        if (hasLiveAnchorKey) return false;
        // Keep stale detection aligned with editorCommentPositions by matching against whichever
        // alias key (commentId/importedId) is currently present in the live position map.
        return !Array.from(aliases).some((alias) => trackedIds.has(alias));
      }),
    );
    if (!staleRootPositionKeys.size) return 0;

    const staleRootAliasIds = new Set();
    staleRootPositionKeys.forEach((positionKey) => {
      const aliases = rootAliasesByPositionKey.get(positionKey) ?? new Set([positionKey]);
      aliases.forEach((alias) => staleRootAliasIds.add(alias));
    });

    const stalePositionKeys = new Set(staleRootPositionKeys);

    commentsList.value.forEach((comment) => {
      const aliasIds = getCommentAliasIds(comment);
      const normalizedPositionKey = resolveExistingPositionKey(aliasIds);
      if (!normalizedPositionKey) return;

      // Extend staleness to replies / child comments that thread under a stale tracked-change root
      const parentKeys = [
        trackedChangeThreadParentIdForComment(comment),
        comment?.threadingParentCommentId,
        comment?.parentCommentId,
      ]
        .map((id) => normalizeCommentId(id))
        .filter(Boolean);

      if (parentKeys.some((id) => staleRootAliasIds.has(id))) {
        stalePositionKeys.add(normalizedPositionKey);
      }
    });

    const nextPositions = { ...currentPositions };
    stalePositionKeys.forEach((key) => {
      delete nextPositions[key];
    });
    editorCommentPositions.value = nextPositions;

    if (activeComment.value !== undefined && activeComment.value !== null) {
      const activeCommentModel = getComment(activeComment.value);
      const activeAliases = new Set(getCommentAliasIds(activeCommentModel ?? activeComment.value));
      // If the active comment is part of a stale tracked-change thread, clear the active state
      const activeParentKeys = [
        trackedChangeThreadParentIdForComment(activeCommentModel),
        activeCommentModel?.threadingParentCommentId,
        activeCommentModel?.parentCommentId,
      ]
        .map((id) => normalizeCommentId(id))
        .filter(Boolean);

      const isActiveStale = Array.from(activeAliases).some((id) => staleRootAliasIds.has(id));
      if (isActiveStale || activeParentKeys.some((id) => staleRootAliasIds.has(id))) {
        clearActiveCommentSelection();
      }
    }

    return stalePositionKeys.size;
  };

  const collectStandardCommentDocumentState = (editor) => {
    const doc = editor?.state?.doc;
    if (!doc || typeof doc.descendants !== 'function') return null;

    const liveMarkIds = new Set();
    const resolvedAnchorIds = new Set();

    doc.descendants((node) => {
      node.marks
        ?.filter((mark) => mark?.type?.name === 'commentMark')
        .forEach((mark) => {
          [mark.attrs?.commentId, mark.attrs?.importedId]
            .map((id) => normalizeCommentId(id))
            .filter(Boolean)
            .forEach((id) => liveMarkIds.add(id));
        });

      const typeName = node.type?.name;
      if (typeName !== 'commentRangeStart' && typeName !== 'commentRangeEnd') return;
      const anchorId = normalizeCommentId(node.attrs?.['w:id']);
      if (anchorId) resolvedAnchorIds.add(anchorId);
    });

    return { liveMarkIds, resolvedAnchorIds };
  };

  /**
   * Fall back to a live editor when the caller has none (the store watchers).
   * `editorCommentPositions` refreshes asynchronously, so a positions-based
   * decision taken mid-undo/redo can act on STALE keys — e.g. clearing the
   * resolved metadata that the redo restore just wrote back. The document
   * itself is the source of truth; prefer it whenever an editor is reachable.
   */
  const getFallbackCommentsEditor = () => {
    const docs = superdocStore.documents;
    if (!Array.isArray(docs)) return null;
    for (const doc of docs) {
      const editor = typeof doc?.getEditor === 'function' ? doc.getEditor() : null;
      if (editor?.state?.doc) return editor;
    }
    return null;
  };

  const syncResolvedCommentsWithDocument = ({ editor } = {}) => {
    // V2 comment lifecycle is owned by the browser Document API list refresh
    // after a committed mutation. The legacy DOM/position heuristic can lag a
    // paint behind and clear only the root, creating an open-root/resolved-reply
    // split after a coherent v2 refresh.
    if (v2CommentsAdapter.value) return 0;
    const effectiveEditor = editor ?? getFallbackCommentsEditor();
    const documentState = collectStandardCommentDocumentState(effectiveEditor);
    const docPositions = editorCommentPositions.value || {};
    const activeKeys = new Set(Object.keys(docPositions));
    if (!documentState && !activeKeys.size) return 0;

    let changed = 0;
    commentsList.value.forEach((comment) => {
      if (!isEditorBackedComment(comment) || isTrackedChangeThread(comment)) return;

      if (documentState) {
        const aliasIds = getCommentAliasIds(comment);
        const hasLiveMark = aliasIds.some((id) => documentState.liveMarkIds.has(id));
        const hasResolvedAnchor = aliasIds.some((id) => documentState.resolvedAnchorIds.has(id));

        if (hasLiveMark && comment.resolvedTime != null) {
          clearResolvedMetadata(comment);
          changed += 1;
          return;
        }

        if (!hasLiveMark && hasResolvedAnchor && comment.resolvedTime == null && restoreResolvedMetadata(comment)) {
          changed += 1;
        }
        return;
      }

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
   * Normalize a position object to a consistent { start, end } format.
   * Handles different editor position schemas (start/end, pos/to, from/to).
   *
   * @param {Object | null | undefined} position The position object
   * @returns {{ start: number, end: number } | null} The normalized range or null
   */
  const getCommentPositionRange = (position) => {
    if (!position) return null;
    const start = position.start ?? position.pos ?? position.from;
    const end = position.end ?? position.to ?? start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  };

  /**
   * Get the editor position data for a comment.
   *
   * @param {Object | string} commentOrId The comment object or comment ID
   * @returns {Object | null} The position data from editorCommentPositions
   */
  const getCommentPosition = (commentOrId) => {
    return resolveCommentPositionEntry(commentOrId).entry ?? null;
  };

  /**
   * Get the text that a comment is anchored to in the document.
   *
   * @param {Object | string} commentOrId The comment object or comment ID
   * @param {Object} [options] Options for text extraction
   * @param {string} [options.separator=' '] Separator for textBetween when crossing nodes
   * @param {boolean} [options.trim=true] Whether to trim whitespace from the result
   * @returns {string | null} The anchored text or null if unavailable
   */
  const getCommentAnchoredText = (commentOrId, options = {}) => {
    const comment = typeof commentOrId === 'object' ? commentOrId : getComment(commentOrId);
    if (!comment) return null;

    const position = resolveCommentPositionEntry(commentOrId).entry ?? null;
    const range = getCommentPositionRange(position);
    if (!range) return null;

    const doc = superdocStore.getDocument(comment.fileId);
    const editor = doc?.getEditor?.();
    const docNode = editor?.state?.doc;
    if (!docNode?.textBetween) return null;

    const separator = options.separator ?? ' ';
    const text = docNode.textBetween(range.start, range.end, separator, separator);
    return options.trim === false ? text : text?.trim();
  };

  /**
   * Get both position and anchored text data for a comment.
   *
   * @param {Object | string} commentOrId The comment object or comment ID
   * @param {Object} [options] Options passed to getCommentAnchoredText
   * @param {string} [options.separator=' '] Separator for textBetween when crossing nodes
   * @param {boolean} [options.trim=true] Whether to trim whitespace from the result
   * @returns {{ position: Object, anchoredText: string | null } | null} The anchor data or null
   */
  const getCommentAnchorData = (commentOrId, options = {}) => {
    const position = getCommentPosition(commentOrId);
    if (!position) return null;
    return {
      position,
      anchoredText: getCommentAnchoredText(commentOrId, options),
    };
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
    documentState = undefined,
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

      // Subsume inline tracked changes inside a tracked whole-table change: the
      // change is owned by the structural "Inserted/Deleted table" bubble and must
      // not become its own review item (no floating bubble, no active-on-click
      // dialog, no separate accept). This is the central chokepoint EVERY creation
      // path funnels through — full resync, targeted resync, AND the live
      // comments-plugin transaction handler — so suppressing here covers them all.
      // The structural bubble itself (display tableInsert/tableDelete) is exempt.
      const isStructuralTableBubble =
        trackedChangeDisplayType === 'tableInsert' || trackedChangeDisplayType === 'tableDelete';
      if (!isStructuralTableBubble && normalizedChangeId) {
        // Resolve the document editor: prefer the event's documentId, fall back to
        // the active editor so the guard still fires if a path omits documentId.
        const effectiveDocumentId =
          normalizedDocumentId ??
          (superdoc?.activeEditor?.options?.documentId != null
            ? String(superdoc.activeEditor.options.documentId)
            : null);
        const docEditor = effectiveDocumentId ? superdocStore.getDocument(effectiveDocumentId)?.getEditor?.() : null;
        const docState =
          documentState !== undefined ? documentState : (docEditor?.state ?? superdoc?.activeEditor?.state ?? null);
        if (docState) {
          // (a) The changeId IS a structural whole-table change id (or one of its
          // row ids) — text typed inside a tracked-inserted row inherits the row's
          // revision id (the cell text and the row share one OOXML w:id). Owned by
          // the structural bubble; no separate item.
          // (a) A distinct-id inline change whose marks are wholly INSIDE a tracked
          // whole-table range is subsumed. (b) Or the changeId is a structural row
          // id echoed with NO inline marks (e.g. the comments-plugin re-emitting the
          // structural change as a generic tracked change) — subsumed too.
          // The id-set match is gated on "no inline range" so an inline change that
          // merely SHARES a row/source id but lives OUTSIDE the table is never
          // wrongly suppressed (its real range fails the table containment check).
          const { ranges: tableRanges, ids: structuralIds } = computeTrackedTableSummaryForState(docState);
          const ranges = trackChangesHelpers.getTrackChanges(docState, normalizedChangeId);
          const inRange =
            tableRanges.length > 0 && ranges.length > 0 && isInlineRangeInsideTrackedTable(ranges, tableRanges);
          const isStructuralRowIdEcho = ranges.length === 0 && structuralIds.has(normalizedChangeId);
          const subsumed = inRange || isStructuralRowIdEcho;
          if (subsumed) {
            // Block creation AND remove any stale duplicate created earlier (e.g.
            // on a prior keystroke or via an import/replay bypass). Pruning never
            // touches the structural bubble (it excludes table-insert/delete).
            pruneSuppressedInlineTableComments({
              suppressedIds: new Set([normalizedChangeId]),
              activeDocumentId: effectiveDocumentId,
              superdoc,
              broadcastChanges,
            });
            return;
          }
        }
      }
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
          const commentAliasIds = getCommentAliasIds(trackedComment);
          const hasCompatibleStory = trackedChangeStoryKeysAreCompatible(
            getTrackedChangeStoryKey(trackedComment),
            incomingStoryKey,
          );
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
        // AIDEV-NOTE: Targeted tracked-change refresh runs during body typing.
        // Emit only when the recomputed comment payload changed, otherwise every
        // keystroke in an unchanged mark can rebroadcast and rerender the sidebar.
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

  const collectTrackedChangeMarksByType = (trackedChanges = []) => ({
    insertedMark: trackedChanges.find(({ mark }) => mark?.type?.name === 'trackInsert')?.mark ?? null,
    deletionMark: trackedChanges.find(({ mark }) => mark?.type?.name === 'trackDelete')?.mark ?? null,
    formatMark: trackedChanges.find(({ mark }) => mark?.type?.name === 'trackFormat')?.mark ?? null,
  });

  const refreshTrackedChangeCommentsByIds = ({ superdoc, editor, changeIds, broadcastChanges = true }) => {
    if (!superdoc || !editor?.state || !Array.isArray(changeIds) || !changeIds.length) return;
    const documentId = editor?.options?.documentId != null ? String(editor.options.documentId) : null;
    if (!documentId) return;

    // Inline changes inside a tracked whole-table change are subsumed by the
    // structural "Inserted/Deleted table" bubble. Suppression + pruning of such a
    // change is handled centrally in `handleTrackedChangeUpdate` (the chokepoint
    // every creation path funnels through), so no per-path check is needed here.
    for (const changeId of new Set(changeIds.map((id) => (id != null ? String(id) : null)).filter(Boolean))) {
      const trackedChangesForId = trackChangesHelpers.getTrackChanges(editor.state, changeId);
      if (!trackedChangesForId.length) continue;

      const marks = collectTrackedChangeMarksByType(trackedChangesForId);
      const params = createOrUpdateTrackedChangeComment({
        event: 'update',
        marks,
        nodes: [],
        newEditorState: editor.state,
        documentId,
        trackedChangesForId,
      });

      if (!params) continue;
      params.trackedChangeStory = BODY_TRACKED_CHANGE_STORY;
      params.trackedChangeStoryKind = 'body';
      params.trackedChangeStoryLabel = '';
      params.trackedChangeAnchorKey = buildBodyTrackedChangeAnchorKey(params.changeId ?? changeId);
      handleTrackedChangeUpdate({ superdoc, params, broadcastChanges });
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
      return currentSelection();
    } catch {
      return null;
    }
  };

  const showAddComment = (superdoc, targetClientY = null) => {
    const v2Adapter = getV2CommentsAdapter(superdoc);
    const pendingSelection = getPendingSelectionSnapshot(superdoc, superdocStore.activeSelection);
    const event = { type: COMMENT_EVENTS.PENDING, pendingSelection };
    superdoc.emit('comments-update', event);

    if (v2Adapter) {
      // ui-phase3-002: v2 mode uses a Vue-only pending sidebar row backed by
      // the v2 selection snapshot. We do not insert a fake 'pending' mark
      // through v1 `insertComment`; commit later dispatches
      // `comments.createFromSelection` after the user submits text.
      const cap = v2Adapter.getCapabilityState?.();
      if (cap && cap.canWrite === false) {
        return { ok: false, reason: cap.reason };
      }
      return Promise.resolve(v2Adapter.captureCurrentSelection?.())
        .then((capture) => {
          if (!capture?.ok) {
            return { ok: false, reason: capture?.reason ?? 'editing-range-required', detail: capture?.detail };
          }
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

    const selection = { ...superdocStore.activeSelection };
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

    if (pendingComment.value.selection.source === DOCUMENT_EDITOR_SELECTION_SOURCE && superdocStore.selectionPosition) {
      superdocStore.selectionPosition.source = DOCUMENT_EDITOR_SELECTION_SOURCE;
    }

    requestInstantSidebarAlignment(targetClientY, 'pending');
    setActiveFloatingCommentInstance(null);
    activeComment.value = pendingComment.value.commentId;
    return { ok: true };
  };

  /**
   * Get the numeric position value for sorting a comment by document order.
   * Checks multiple position properties to handle different editor position schemas
   * (e.g., ProseMirror uses from/to, other editors may use start/pos).
   *
   * @param {Object} comment - The comment object
   * @returns {number|null} The position value, or null if not found
   */
  const getPositionSortValue = (comment) => {
    const position = resolveCommentPositionEntry(comment).entry;
    if (!position) return null;
    // Check different position properties to handle various editor position schemas
    if (Number.isFinite(position.start)) return position.start;
    if (Number.isFinite(position.pos)) return position.pos;
    if (Number.isFinite(position.from)) return position.from;
    if (Number.isFinite(position.to)) return position.to;
    if (Number.isFinite(position.pageIndex) && Number.isFinite(position?.bounds?.top)) {
      return position.pageIndex * 1_000_000 + position.bounds.top;
    }
    return null;
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
   * Comparator that sorts comments by document position (ascending).
   * Comments without positions are sorted after those with positions.
   * Falls back to creation time when positions are equal or unavailable.
   *
   * @param {Object} a - First comment
   * @param {Object} b - Second comment
   * @returns {number} Comparison result
   */
  const compareByPosition = (a, b) => {
    const posA = getPositionSortValue(a);
    const posB = getPositionSortValue(b);

    const hasA = Number.isFinite(posA);
    const hasB = Number.isFinite(posB);

    if (hasA && hasB && posA !== posB) return posA - posB;
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;
    return compareByCreatedTime(a, b);
  };

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

  const buildGroupedComments = (sorter) => buildGroupedCommentsFrom(commentsList.value, sorter);

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

  /** @type {import('vue').ComputedRef<{parentComments: Array, resolvedComments: Array}>} Comments grouped and sorted by document position */
  const getCommentsByPosition = computed(() => buildGroupedComments(compareByPosition));

  const hasOverlapId = (id) => overlappedIds.includes(id);
  const documentsWithConverations = computed(() => {
    return superdocStore.documents;
  });

  const getConfig = computed(() => {
    return commentsConfig;
  });

  const getCommentLocation = (selection, parent) => {
    const containerBounds = selection.getContainerLocation(parent);
    const top = containerBounds.top + selection.selectionBounds.top;
    const left = containerBounds.left + selection.selectionBounds.left;
    return {
      top: top,
      left: left,
    };
  };

  /**
   * Get a new pending comment
   *
   * @param {Object} param0
   * @param {Object} param0.selection The selection object
   * @param {String} param0.documentId The document ID
   * @param {String} param0.parentCommentId The parent comment
   * @returns {Object} The new comment object
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
  const removePendingComment = (superdoc) => {
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
    // would touch a null `commands` surface.
    if (isV2EditorActive(superdoc)) return;
    superdoc?.activeEditor?.commands?.removeComment({ commentId: 'pending' });
  };

  /**
   * Add a new comment to the document
   *
   * @param {Object} param0
   * @param {Object} param0.superdoc The SuperDoc instance
   * @returns {void}
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
      // ui-phase3-002: in v2 mode the create / reply path delegates to the
      // Document API compatibility adapter. Vue state is not mutated until
      // the synchronous receipt commits and we refresh from
      // `host.getHandles().comments.list()`. This keeps the sidebar
      // receipt-driven; rejected mutations never produce orphan sidebar rows.
      const text = normalizeV2CommentDraftText(pendingComment.value ? currentCommentText.value : comment.commentText);
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
        const reconciled = reconcileCommentsFromV2({
          superdoc,
          adapter: v2Adapter,
          documentId: v2Adapter.documentId,
          items: outcome.items,
        });
        const hadPendingComment = !!pendingComment.value;
        if (hadPendingComment) removePendingComment(superdoc);
        // Hand off activeComment/instance to the newly created comment instead
        // of leaving it null, so the floating sidebar keeps treating this row
        // as active (viewport exemption, dialog mount, collision pinning) and
        // never observes an intermediate null in the same reactive flush.
        const createdId = reconciled?.added?.commentId ?? null;
        if (hadPendingComment && createdId) {
          setActiveComment(superdoc, createdId);
          setActiveFloatingCommentInstance(createdId);
        }
        if (broadcastChanges) {
          superdoc.emit('comments-update', {
            type: COMMENT_EVENTS.ADD,
            comment: reconciled?.added?.getValues?.() ?? null,
          });
        }
        return { ok: true, comment: reconciled?.added ?? null };
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

    removedComments.forEach((comment) => {
      const payload = typeof comment.getValues === 'function' ? comment.getValues() : comment;
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
   */
  const replyCommentV2 = async ({ superdoc, parentCommentId, text, mentions = [], trackedChangeTarget } = {}) => {
    if (commentsAreReadOnly()) return readOnlyMutationOutcome();

    const v2Adapter = getV2CommentsAdapter(superdoc);
    if (!v2Adapter) return { ok: false, reason: 'v2-comments-adapter-missing' };

    const normalizedParent = parentCommentId != null ? String(parentCommentId) : null;
    if (!normalizedParent) return { ok: false, reason: 'parent-comment-id-missing' };
    const plainText = normalizeV2CommentDraftText(text);
    if (plainText.length === 0) {
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
      // AIDEV-NOTE: Review rows are reactive, but the mutation target crosses
      // a worker boundary and must contain cloneable plain data only.
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
      successEventBuilder: ({ reconciled }) => ({
        type: COMMENT_EVENTS.ADD,
        comment: reconciled?.added?.getValues?.() ?? null,
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
    if (plainText.length === 0) {
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

  // TCS Phase 0 / 001: hydration + reconciliation helpers. Both are no-ops
  // when the v2 adapter is missing; the v1 path keeps the existing
  // `processLoadedDocxComments` flow.
  //
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
      for (const row of commentsList.value) {
        if (!belongsToTrackedChangeSyncDocument(row, documentId)) continue;
        const ids = reviewPresentationIdentityIds(row);
        if (![...ids].some((id) => retainedIds.has(id))) continue;
        for (const id of ids) {
          if (retainedIds.has(id)) continue;
          retainedIds.add(id);
          changed = true;
        }
      }
    }

    commentsList.value = commentsList.value.filter((row) => {
      if (!belongsToTrackedChangeSyncDocument(row, documentId)) return true;
      if (row === pendingComment.value) return true;
      return [...reviewPresentationIdentityIds(row)].some((id) => retainedIds.has(id));
    });
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
        if (!Array.isArray(commentItems) || !Array.isArray(trackedChangeItems)) {
          return { ok: false, reason: 'items-invalid' };
        }
        if (trackedList?.complete !== false || trackedList?.visibleWindowSource !== 'visible-window') {
          return { ok: false, reason: 'tracked-list-not-partial-visible-window' };
        }
        if (
          typeof commentsAdapter.mapV2CommentToUseCommentInput !== 'function' ||
          typeof trackedChangesAdapter.mapV2TrackedChangeToCommentParams !== 'function'
        ) {
          return { ok: false, reason: 'adapter-mapper-missing' };
        }

        let effectiveCommentItems = commentItems;
        if (typeof commentsAdapter.seedReviewCatalog === 'function') {
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
          preparedInputs = effectiveCommentItems
            .filter((item) => !isSyntheticTrackedChangeCommentLaneItem(item))
            .map((item) =>
              commentsAdapter.mapV2CommentToUseCommentInput(item, {
                fileId: normalizedDocumentId,
                fileType,
              }),
            )
            .filter(Boolean);
          preparedParams = trackedChangeItems
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
          reconcileTrackedChangesFromV2({
            superdoc,
            adapter: trackedChangesAdapter,
            documentId: normalizedDocumentId,
            items: trackedChangeItems,
            preparedParams,
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

        commentsList.value = nextList;

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
   * Imported DOCX comments can omit the normalized author string.
   * Strip the exporter suffix when present and tolerate missing metadata.
   *
   * @param {string | null | undefined} creatorName
   * @returns {string | null}
   */
  const normalizeImportedCreatorName = (creatorName) => {
    if (typeof creatorName !== 'string') {
      return null;
    }

    const normalizedName = creatorName.replace(/\s*\(imported\)\s*$/u, '').trim();
    return normalizedName || null;
  };

  /**
   * Read the mounted editor view and state without touching `editor.state`.
   * The editor convenience getter delegates to `view.state` and throws after
   * teardown, which is precisely when a deferred import callback can run.
   *
   * @param {Object | null | undefined} editor
   * @returns {{ view: Object, state: Object } | null}
   */
  const readMountedEditorSnapshot = (editor) => {
    if (!editor) return null;

    try {
      if (editor.isDestroyed === true) return null;
      const view = editor.view;
      if (!view || view.isDestroyed === true || view.destroyed === true) return null;
      const state = view.state;
      if (!state) return null;
      return { view, state };
    } catch {
      return null;
    }
  };

  const normalizeBootstrapDocumentId = (documentId) =>
    documentId !== undefined && documentId !== null && String(documentId).length > 0 ? String(documentId) : null;

  /**
   * Cancel deferred imported tracked-change comment work. Passing a document
   * id cancels only that document; omitting it cancels every pending task.
   *
   * @param {string | null | undefined} documentId
   * @returns {number} number of invalidated tasks
   */
  const cancelImportedTrackedChangeBootstrap = (documentId) => {
    const normalizedDocumentId = normalizeBootstrapDocumentId(documentId);
    const entries = normalizedDocumentId
      ? [[normalizedDocumentId, importedTrackedChangeBootstrapTasks.get(normalizedDocumentId)]]
      : Array.from(importedTrackedChangeBootstrapTasks.entries());
    let canceled = 0;

    for (const [taskDocumentId, task] of entries) {
      if (!task) continue;
      importedTrackedChangeBootstrapTasks.delete(taskDocumentId);
      if (task.timeoutHandle !== null && task.timeoutHandle !== undefined) {
        clearTimeout(task.timeoutHandle);
      }
      canceled += 1;
    }

    return canceled;
  };

  const captureImportedTrackedChangeBootstrapSnapshot = (editor) => {
    const mountedEditor = readMountedEditorSnapshot(editor);
    if (!mountedEditor) return null;

    let trackedChanges = [];
    try {
      trackedChanges = trackChangesHelpers.getTrackChanges(mountedEditor.state) ?? [];
    } catch {
      return null;
    }
    const enumerateStructuralChanges = trackChangesHelpers?.enumerateStructuralRowChanges;
    let structuralChanges = [];
    if (typeof enumerateStructuralChanges === 'function') {
      try {
        structuralChanges = enumerateStructuralChanges(mountedEditor.state) ?? [];
      } catch {
        structuralChanges = [];
      }
    }

    let storySnapshots = [];
    if (typeof getTrackedChangeIndex === 'function') {
      try {
        storySnapshots = getTrackedChangeIndex(editor)?.getAll?.() ?? [];
      } catch {
        storySnapshots = [];
      }
    }

    return {
      ...mountedEditor,
      trackedChanges,
      structuralChanges,
      storySnapshots,
    };
  };

  /**
   * Bootstrap tracked-change comment threads after a DOCX import finishes.
   *
   * Initial import historically rebuilt only body tracked-change threads so
   * resolved imported body comments stayed resolved. Header/footer and note
   * tracked changes live outside the body PM state, so they need an additional
   * story-aware bootstrap pass here.
   *
   * We intentionally keep the existing body-only rebuild instead of switching
   * to the broader syncTrackedChangeComments() path so imported resolved body
   * tracked-change threads preserve their initial resolved state.
   *
   * @param {Object | null | undefined} editor
   * @param {Object | null | undefined} superdoc
   * @param {Object | null | undefined} snapshot
   * @returns {boolean}
   */
  const bootstrapImportedTrackedChangeComments = (editor, superdoc, snapshot = null) => {
    if (!editor || !superdoc) return false;

    const captured = snapshot ?? captureImportedTrackedChangeBootstrapSnapshot(editor);
    if (!captured) return false;

    createCommentForTrackChanges(editor, superdoc, captured.trackedChanges, {
      editorState: captured.state,
      editorView: captured.view,
    });
    syncStoryTrackedChangeComments({
      superdoc,
      editor,
      snapshots: captured.storySnapshots,
      documentState: captured.state,
      resolveFromEditor: false,
    });
    // Whole-table structural tracked changes live on node attrs (not inline
    // marks), so `createCommentForTrackChanges` never sees them. Without this
    // pass the "Added table" right-rail bubble is not created on import and
    // only appears after a later transaction triggers the full
    // `syncTrackedChangeComments` path. Mirror the inline/story bootstrap here.
    // Idempotent: `syncStructuralTrackedChangeComments` upserts (event 'update'
    // when a matching bubble already exists), so re-running it later does not
    // duplicate bubbles.
    syncStructuralTrackedChangeComments({
      superdoc,
      editor,
      structuralChanges: captured.structuralChanges,
    });
    return true;
  };

  const isCurrentImportedTrackedChangeBootstrap = (task) => {
    if (!task) return false;
    if (importedTrackedChangeBootstrapTasks.get(task.documentId) !== task) return false;

    try {
      const editorDocumentId = task.editor?.options?.documentId;
      if (editorDocumentId != null && String(editorDocumentId) !== task.documentId) return false;

      const mountedDocument = superdocStore.getDocument(task.documentId);
      if (!mountedDocument) return false;
      const mountedEditor = mountedDocument.getEditor?.();
      if (mountedEditor !== task.editor) return false;
    } catch {
      return false;
    }

    return true;
  };

  const runImportedTrackedChangeBootstrap = (task) => {
    if (!isCurrentImportedTrackedChangeBootstrap(task)) {
      if (importedTrackedChangeBootstrapTasks.get(task?.documentId) === task) {
        importedTrackedChangeBootstrapTasks.delete(task.documentId);
      }
      return false;
    }

    const snapshot = captureImportedTrackedChangeBootstrapSnapshot(task.editor);
    // A state/view getter can synchronously trigger teardown. Re-check the
    // generation after capture before allowing any store mutation.
    if (!snapshot || !isCurrentImportedTrackedChangeBootstrap(task)) {
      if (importedTrackedChangeBootstrapTasks.get(task.documentId) === task) {
        importedTrackedChangeBootstrapTasks.delete(task.documentId);
      }
      return false;
    }

    try {
      return bootstrapImportedTrackedChangeComments(task.editor, task.superdoc, snapshot);
    } finally {
      if (importedTrackedChangeBootstrapTasks.get(task.documentId) === task) {
        importedTrackedChangeBootstrapTasks.delete(task.documentId);
      }
    }
  };

  const scheduleImportedTrackedChangeBootstrap = ({ editor, superdoc, documentId, defer = true }) => {
    const normalizedDocumentId = normalizeBootstrapDocumentId(documentId);
    if (!normalizedDocumentId || !editor || !superdoc) return false;

    cancelImportedTrackedChangeBootstrap(normalizedDocumentId);
    const task = {
      documentId: normalizedDocumentId,
      editor,
      superdoc,
      generation: ++importedTrackedChangeBootstrapGeneration,
      timeoutHandle: null,
    };
    importedTrackedChangeBootstrapTasks.set(normalizedDocumentId, task);

    if (!defer) return runImportedTrackedChangeBootstrap(task);

    task.timeoutHandle = setTimeout(() => {
      task.timeoutHandle = null;
      runImportedTrackedChangeBootstrap(task);
    }, 0);
    return true;
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
    cancelImportedTrackedChangeBootstrap(activeDocumentId);

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

  function resetCommentsForReplacedDocument(documentId) {
    removeCommentsForDocument(documentId);
  }

  /**
   * Initialize loaded comments into SuperDoc by mapping the imported
   * comment data to SuperDoc useComment objects.
   *
   * Updates the commentsList ref with the new comments.
   *
   * @param {Object} param0
   * @param {Array} param0.comments The comments to be loaded
   * @param {String} param0.documentId The document ID
   * @param {boolean} [param0.replacedFile] Whether this load replaces an existing document in place
   * @returns {void}
   */
  const processLoadedDocxComments = async ({ superdoc, editor, comments, documentId, replacedFile = false }) => {
    const document = superdocStore.getDocument(documentId);
    if (document?.commentThreadingProfile) {
      document.commentThreadingProfile.value = editor?.converter?.commentThreadingProfile || null;
    }

    if (replacedFile) {
      resetCommentsForReplacedDocument(documentId);
    }

    comments.forEach((comment) => {
      const textElements = Array.isArray(comment.elements) ? comment.elements : [];
      const htmlContent = getHtmlFromComment(textElements);

      if (!htmlContent && !comment.trackedChange) {
        return;
      }

      const creatorName = normalizeImportedCreatorName(comment.creatorName);
      const importedName = creatorName ? `${creatorName} (imported)` : null;
      const newComment = useComment({
        fileId: documentId,
        fileType: document.type,
        docxCommentJSON: textElements.length ? textElements : null,
        commentId: comment.commentId,
        isInternal: false,
        parentCommentId: comment.parentCommentId,
        trackedChangeParentId: comment.trackedChangeParentId,
        trackedChangeThreadParentId: comment.trackedChangeThreadParentId,
        creatorId: null,
        creatorName,
        createdTime: comment.createdTime,
        creatorEmail: comment.creatorEmail,
        importedAuthor: {
          ...(importedName ? { name: importedName } : {}),
          email: comment.creatorEmail,
        },
        commentText: htmlContent,
        resolvedTime: comment.isDone ? Date.now() : null,
        resolvedById: null,
        resolvedByEmail: comment.isDone ? comment.creatorEmail : null,
        resolvedByName: comment.isDone ? importedName || '(Imported)' : null,
        trackedChange: comment.trackedChange || false,
        trackedChangeText: comment.trackedChangeText,
        trackedChangeType: comment.trackedChangeType,
        trackedChangeDisplayType: comment.trackedChangeDisplayType,
        deletedText: comment.trackedDeletedText,
        // Preserve origin metadata for export
        origin: comment.origin || 'word', // Default to 'word' for backward compatibility
        threadingMethod: comment.threadingMethod,
        threadingStyleOverride: comment.threadingStyleOverride,
        threadingParentCommentId: comment.threadingParentCommentId,
        originalXmlStructure: comment.originalXmlStructure,
      });

      addHydratedComment({ superdoc, comment: newComment });
    });

    if (replacedFile) {
      scheduleImportedTrackedChangeBootstrap({ editor, superdoc, documentId, defer: false });
      return;
    }

    // Do not block the first rendering of the doc. Rebuild tracked-change
    // threads asynchronously once the editor is ready for comment sync.
    scheduleImportedTrackedChangeBootstrap({ editor, superdoc, documentId });
  };

  const createCommentForTrackChanges = (editor, superdoc, trackedChangesOverride = null, options = {}) => {
    const {
      reopenResolved = false,
      refreshExisting = false,
      broadcastChanges = true,
      editorState: editorStateOverride = null,
      editorView: editorViewOverride = null,
    } = options;
    const mountedEditor = editorStateOverride
      ? { state: editorStateOverride, view: editorViewOverride }
      : readMountedEditorSnapshot(editor);
    if (!mountedEditor?.state) return;
    const editorState = mountedEditor.state;
    const trackedChanges = trackedChangesOverride ?? trackChangesHelpers.getTrackChanges(editorState);
    const groupedChanges = groupChanges(trackedChanges);
    const activeDocumentId = editor?.options?.documentId != null ? String(editor.options.documentId) : null;
    if (!activeDocumentId) return;

    // Build a Set of existing unresolved tracked-change IDs for O(1) lookup
    // and a map of id -> comment so we can refresh existing text when needed.
    // History replay can opt in to excluding resolved tracked-change threads so
    // undo/redo reopens them when their marks reappear. Initial import rebuilds
    // keep resolved DOCX threads in the set so resolved threads do not reopen.
    const skipIds = new Set();
    const existingTrackedChangeById = new Map();
    commentsList.value.forEach((comment) => {
      if (!comment?.trackedChange) return;
      if (!belongsToTrackedChangeSyncDocument(comment, activeDocumentId)) return;
      if (!isBodyTrackedChangeComment(comment)) return;
      const commentIds = [comment.commentId, comment.importedId]
        .map((id) => (id != null ? String(id) : null))
        .filter(Boolean);

      if (comment.resolvedTime) {
        if (!reopenResolved) {
          commentIds.forEach((id) => skipIds.add(id));
        }
        return;
      }

      commentIds.forEach((id) => {
        existingTrackedChangeById.set(id, comment);
        if (!refreshExisting) {
          skipIds.add(id);
        }
      });
    });

    // Build a Map of change ID → tracked change entries for O(1) lookup per group.
    // This avoids re-scanning the entire document for each tracked change.
    const changesByIdMap = new Map();
    for (const change of trackedChanges) {
      const id = change.mark.attrs.id;
      if (!changesByIdMap.has(id)) changesByIdMap.set(id, []);
      changesByIdMap.get(id).push(change);
    }

    const documentId = activeDocumentId;

    // Inline changes inside a tracked whole-table change are subsumed by the
    // structural "Inserted/Deleted table" bubble. Suppression + pruning of such a
    // change is handled centrally in `handleTrackedChangeUpdate` (called per
    // change below), so no per-path check is needed here.
    const processedIds = new Set();
    groupedChanges.forEach(({ insertedMark, deletionMark, formatMark }) => {
      const id = insertedMark?.mark.attrs.id || deletionMark?.mark.attrs.id || formatMark?.mark.attrs.id;
      if (id == null) return;
      const normalizedId = String(id);
      if (processedIds.has(normalizedId)) return;
      processedIds.add(normalizedId);

      if (!refreshExisting && skipIds.has(normalizedId)) return;
      const existingTrackedChange = existingTrackedChangeById.get(normalizedId);

      const marks = {
        ...(insertedMark && { insertedMark: insertedMark.mark }),
        ...(deletionMark && { deletionMark: deletionMark.mark }),
        ...(formatMark && { formatMark: formatMark.mark }),
      };

      // nodes/deletionNodes are unused here — the function resolves them from
      // trackedChangesForId which already contains all document positions for this ID.
      const params = createOrUpdateTrackedChangeComment({
        event: existingTrackedChange ? 'update' : 'add',
        marks,
        nodes: [],
        newEditorState: editorState,
        documentId,
        trackedChangesForId: changesByIdMap.get(id) || [],
      });

      if (params) {
        const anchorKey = buildBodyTrackedChangeAnchorKey(params.changeId ?? id);
        params.trackedChangeStory = BODY_TRACKED_CHANGE_STORY;
        params.trackedChangeStoryKind = 'body';
        params.trackedChangeStoryLabel = '';
        params.trackedChangeAnchorKey = anchorKey;
        handleTrackedChangeUpdate({ superdoc, params, broadcastChanges, documentState: editorState });
        if (!existingTrackedChange) {
          skipIds.add(normalizedId);
          if (params.changeId != null) skipIds.add(String(params.changeId));
          if (params.importedId != null) skipIds.add(String(params.importedId));
        }
      }
    });

    // Single force-update to refresh decorations
    const editorView = mountedEditor.view;
    try {
      if (
        !editorView ||
        editor.view !== editorView ||
        editorView.isDestroyed === true ||
        editorView.destroyed === true
      ) {
        return;
      }
    } catch {
      return;
    }
    const { tr } = editorState;
    tr.setMeta(CommentsPluginKey, { type: 'force' });
    editorView.dispatch(tr);
  };

  /**
   * Remove inline tracked-change comments whose change id is subsumed by a
   * tracked whole-table change. Mirrors the deletion-event emission of
   * `pruneStaleTrackedChangeComments` but is keyed on an explicit suppressed-id
   * set rather than mark liveness (the mark is still live; only the review item
   * is unwanted). Also clears the active-comment selection if it pointed at a
   * now-suppressed change, so no stale active-on-click dialog can reference it.
   *
   * @param {{ suppressedIds: Set<string>, activeDocumentId: string, superdoc: any, broadcastChanges?: boolean }} input
   */
  const pruneSuppressedInlineTableComments = ({
    suppressedIds,
    activeDocumentId,
    superdoc = null,
    broadcastChanges = true,
  }) => {
    if (!(suppressedIds instanceof Set) || !suppressedIds.size || !activeDocumentId) return;

    const removedComments = [];
    commentsList.value = commentsList.value.filter((comment) => {
      if (!comment?.trackedChange) return true;
      if (!isBodyTrackedChangeComment(comment)) return true;
      if (isStructuralTableBubble(comment)) return true;
      if (!belongsToTrackedChangeSyncDocument(comment, activeDocumentId)) return true;

      const commentId = comment.commentId != null ? String(comment.commentId) : null;
      const importedId = comment.importedId != null ? String(comment.importedId) : null;
      const isSuppressed = (commentId && suppressedIds.has(commentId)) || (importedId && suppressedIds.has(importedId));
      if (!isSuppressed) return true;

      removedComments.push(comment);
      return false;
    });

    if (!removedComments.length) return;

    const removedIds = new Set();
    removedComments.forEach((comment) => {
      if (comment.commentId != null) removedIds.add(String(comment.commentId));
      if (comment.importedId != null) removedIds.add(String(comment.importedId));
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
    if (activeCommentId && removedIds.has(activeCommentId)) {
      clearActiveCommentSelection();
    }
  };

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
  // Duplicate rows that share a body identity (commentId / importedId /
  // canonical / anchor / position aliases) are collapsed to the earliest
  // survivor. Move-from/move-to sides keep distinct commentIds under one
  // canonical id; those only join on commentId so the pair is not merged.
  const getBodyTrackedChangeIdentityIds = (comment) => {
    const commentId = normalizeCommentId(comment.commentId);
    const canonicalId = normalizeCommentId(comment.trackedChangeCanonicalId);
    const hasSyntheticSideIdentity = canonicalId && canonicalId !== commentId;
    return [
      commentId,
      ...(!hasSyntheticSideIdentity
        ? [
            comment.importedId,
            canonicalId,
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
   * Rebuild tracked-change comments from the current editor state.
   *
   * Useful after bulk document transforms (like diff replay) where tracked-change
   * marks may be remapped and incremental tracked-change events are not emitted.
   *
   * @param {Object} param0
   * @param {Object} param0.superdoc The SuperDoc instance.
   * @param {Object} param0.editor The active Super Editor instance.
   * @returns {void}
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
    const indexedRows = new Set();
    let aliasLookups = 0;
    let candidateVisits = 0;
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
      getCommentAliasIds(comment).forEach((alias) => addAlias(byIdentityAlias, alias, comment));
    };
    commentsList.value.forEach(add);
    return {
      add,
      work: () => ({
        trackedRowsIndexed: indexedRows.size,
        invalidatedIdMembershipChecks: 0,
        incomingAliasLookups: aliasLookups,
        candidateVisits,
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
        try {
          for (const params of paramsList) {
            if (!params) continue;
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

  const syncTrackedChangeComments = ({ superdoc, editor, broadcastChanges = true }) => {
    if (!superdoc || !editor) return;
    const activeDocumentId = editor?.options?.documentId != null ? String(editor.options.documentId) : null;
    if (!activeDocumentId) return;

    const captured = captureImportedTrackedChangeBootstrapSnapshot(editor);
    if (!captured) return;
    const trackedChanges = captured.trackedChanges;
    const liveTrackedChangeIds = new Set();
    trackedChanges.forEach((change) => {
      const id = change?.mark?.attrs?.id;
      if (id == null) return;
      liveTrackedChangeIds.add(String(id));
    });

    const storySnapshots = captured.storySnapshots;
    const liveTrackedChangeAnchorKeys = new Set(
      storySnapshots
        .map((snapshot) => snapshot?.anchorKey)
        .filter((anchorKey) => typeof anchorKey === 'string' && anchorKey.length > 0),
    );

    pruneStaleTrackedChangeComments(liveTrackedChangeIds, liveTrackedChangeAnchorKeys, activeDocumentId, superdoc, {
      broadcastChanges,
    });
    createCommentForTrackChanges(editor, superdoc, trackedChanges, {
      reopenResolved: true,
      refreshExisting: true,
      broadcastChanges,
      editorState: captured.state,
      editorView: captured.view,
    });

    syncStoryTrackedChangeComments({
      superdoc,
      editor,
      broadcastChanges,
      snapshots: storySnapshots,
      documentState: captured.state,
    });
    syncStructuralTrackedChangeComments({
      superdoc,
      editor,
      broadcastChanges,
      structuralChanges: captured.structuralChanges,
    });
  };

  /**
   * Surface decidable whole-table structural tracked changes (table insert /
   * table delete) as right-rail bubbles, mirroring the inline tracked-change
   * path. Structural row revisions live on node attrs (not inline marks), so
   * the inline `getTrackChanges` enumerator never sees them — they are
   * enumerated separately here.
   *
   * Only `decidable` whole-table changes are surfaced; partial/mixed shapes are
   * not actionable (the decision engine fails them closed) so they get no
   * bubble. The bubble id is the document-api public id so accept/reject in the
   * sidebar routes `trackChanges.decide` to the same change.
   *
   * Positioning: the bubble carries a body-story anchorKey (matching the
   * tracked-change index snapshot) and a body PM range (table start/end). The
   * DocumentRendererRuntime position pass emits a body-story position entry for that
   * anchorKey, whose bounds resolve through the same `getRangeRects` path inline
   * body comments/TC use — so it lines up with the table in layout-engine
   * viewing mode.
   */
  const syncStructuralTrackedChangeComments = ({
    superdoc,
    editor,
    broadcastChanges = true,
    structuralChanges: structuralChangesOverride = null,
  }) => {
    const activeDocumentId = editor?.options?.documentId != null ? String(editor.options.documentId) : null;
    if (!activeDocumentId) return;

    const enumerate = trackChangesHelpers?.enumerateStructuralRowChanges;
    if (typeof enumerate !== 'function') return;

    let structuralChanges = structuralChangesOverride;
    if (!Array.isArray(structuralChanges)) {
      const mountedEditor = readMountedEditorSnapshot(editor);
      if (!mountedEditor) return;
      try {
        structuralChanges = enumerate(mountedEditor.state) ?? [];
      } catch {
        structuralChanges = [];
      }
    }

    for (const structural of structuralChanges) {
      // Only decidable whole-table changes are actionable from the sidebar.
      if (!structural?.decidable || !structural?.wholeTable) continue;

      const publicId = buildStructuralTrackedChangeId(structural);
      if (!publicId) continue;

      const anchorKey = buildBodyTrackedChangeAnchorKey(publicId);
      const displayType = structural.subtype === 'table-insert' ? 'tableInsert' : 'tableDelete';
      const trackedChangeType = structural.side === 'insertion' ? 'trackInsert' : 'trackDelete';

      // Mirror the story path: 'add' creates a bubble when none exists yet and
      // refreshes an existing one; 'update' alone would no-op on first import
      // (handleTrackedChangeUpdate returns early when no comment is found).
      const normalizedPublicId = String(publicId);
      const normalizedAnchorKey = anchorKey != null ? String(anchorKey) : null;
      const existingComment = commentsList.value.find((comment) => {
        if (!comment?.trackedChange) return false;
        if (!belongsToTrackedChangeSyncDocument(comment, activeDocumentId)) return false;
        const commentAnchorKey = comment.trackedChangeAnchorKey != null ? String(comment.trackedChangeAnchorKey) : null;
        if (normalizedAnchorKey && commentAnchorKey) return commentAnchorKey === normalizedAnchorKey;
        const commentId = comment.commentId != null ? String(comment.commentId) : null;
        const importedId = comment.importedId != null ? String(comment.importedId) : null;
        return commentId === normalizedPublicId || importedId === normalizedPublicId;
      });

      const params = {
        event: existingComment ? 'update' : 'add',
        changeId: publicId,
        trackedChangeText: '',
        trackedChangeType,
        trackedChangeDisplayType: displayType,
        deletedText: null,
        authorId: null,
        authorEmail: structural.authorEmail || null,
        authorImage: structural.authorImage || null,
        date: structural.date || null,
        author: structural.author || null,
        // Match the inline tracked-change shape: the comment layer reads
        // `importedAuthor.name` (see use-comment.js `getCommentUser`). Passing the
        // raw string would make `.name` undefined and fall back to "(Imported)".
        importedAuthor: structural.importedAuthor ? { name: structural.importedAuthor } : null,
        semanticColorKey: structural.semanticColorKey ?? null,
        semanticColor: structural.semanticColor ?? null,
        documentId: activeDocumentId,
        coords: null,
        trackedChangeStory: BODY_TRACKED_CHANGE_STORY,
        trackedChangeStoryKind: 'body',
        trackedChangeStoryLabel: '',
        trackedChangeAnchorKey: anchorKey,
      };

      handleTrackedChangeUpdate({ superdoc, params, broadcastChanges });
    }
  };

  const syncStoryTrackedChangeComments = ({
    superdoc,
    editor,
    broadcastChanges = true,
    snapshots = null,
    documentState = undefined,
    resolveFromEditor = true,
  }) => {
    const activeDocumentId = editor?.options?.documentId != null ? String(editor.options.documentId) : null;
    if (!activeDocumentId) return;

    let resolvedSnapshots = snapshots;
    if (!Array.isArray(resolvedSnapshots)) {
      if (typeof getTrackedChangeIndex !== 'function') return;
      if (!readMountedEditorSnapshot(editor)) return;
      let index = null;
      try {
        index = getTrackedChangeIndex(editor);
      } catch {
        return;
      }
      if (!index) return;
      try {
        resolvedSnapshots = index.getAll();
      } catch {
        return;
      }
    }

    for (const snapshot of resolvedSnapshots) {
      if (snapshot.storyKind === 'body') continue;
      upsertStoryTrackedChangeComment({
        superdoc,
        editor,
        snapshot,
        documentId: activeDocumentId,
        broadcastChanges,
        documentState,
        resolveFromEditor,
      });
    }
  };

  const getStoryTrackedChangeDisplayType = (snapshot) => {
    if (snapshot?.type !== 'structural') return snapshot?.type ?? null;
    return snapshot?.subtype === 'table-delete' ? 'tableDelete' : 'tableInsert';
  };

  const getStoryTrackedChangeType = (snapshot) => {
    if (snapshot?.type !== 'structural') return snapshot?.type ?? null;
    return snapshot?.subtype === 'table-delete' ? 'trackDelete' : 'trackInsert';
  };

  const isStoryTrackedChangeDeletion = (snapshot) => {
    if (!snapshot) return false;
    if (snapshot.type === 'delete') return true;
    return snapshot.type === 'structural' && snapshot.subtype === 'table-delete';
  };

  const buildStoryTrackedChangeParams = ({ editor, snapshot, documentId, event, resolveFromEditor = true }) => {
    const trackedChangeType = getStoryTrackedChangeType(snapshot);
    const trackedChangeDisplayType = getStoryTrackedChangeDisplayType(snapshot);
    const fallbackParams = {
      event,
      changeId: snapshot.runtimeRef.rawId,
      trackedChangeText: isStoryTrackedChangeDeletion(snapshot) ? '' : (snapshot.excerpt ?? ''),
      trackedChangeType,
      trackedChangeDisplayType,
      semanticColorKey: snapshot.semanticColorKey ?? null,
      semanticColor: snapshot.semanticColor ?? null,
      deletedText: isStoryTrackedChangeDeletion(snapshot) ? (snapshot.excerpt ?? '') : null,
      authorId: snapshot.authorId,
      authorEmail: snapshot.authorEmail,
      authorImage: snapshot.authorImage,
      date: snapshot.date,
      author: snapshot.author,
      documentId,
      coords: null,
      trackedChangeStory: snapshot.story,
      trackedChangeStoryKind: snapshot.storyKind,
      trackedChangeStoryLabel: snapshot.storyLabel,
      trackedChangeAnchorKey: snapshot.anchorKey,
    };

    if (!resolveFromEditor || typeof resolveTrackedChangeInStory !== 'function') return fallbackParams;

    let resolvedChange = null;
    try {
      resolvedChange = resolveTrackedChangeInStory(editor, {
        kind: 'entity',
        entityType: 'trackedChange',
        entityId: snapshot.runtimeRef.rawId,
        story: snapshot.story,
      });
    } catch {
      resolvedChange = null;
    }

    const storyEditorState = resolvedChange?.editor?.state ?? null;
    if (!storyEditorState) return fallbackParams;

    let trackedChangesForId = [];
    try {
      trackedChangesForId = trackChangesHelpers.getTrackChanges(storyEditorState, resolvedChange.change.rawId) ?? [];
    } catch {
      trackedChangesForId = [];
    }

    const marks = collectTrackedChangeMarksByType(trackedChangesForId);

    const resolvedParams = createOrUpdateTrackedChangeComment({
      event,
      marks,
      nodes: [],
      newEditorState: storyEditorState,
      documentId,
      trackedChangesForId,
    });

    if (!resolvedParams) return fallbackParams;

    if (resolvedParams.semanticColorKey == null && snapshot.semanticColorKey != null) {
      resolvedParams.semanticColorKey = snapshot.semanticColorKey;
    }
    if (resolvedParams.semanticColor == null && snapshot.semanticColor != null) {
      resolvedParams.semanticColor = snapshot.semanticColor;
    }
    resolvedParams.trackedChangeStory = snapshot.story;
    resolvedParams.trackedChangeStoryKind = snapshot.storyKind;
    resolvedParams.trackedChangeStoryLabel = snapshot.storyLabel;
    resolvedParams.trackedChangeAnchorKey = snapshot.anchorKey;
    return resolvedParams;
  };

  const upsertStoryTrackedChangeComment = ({
    superdoc,
    editor,
    snapshot,
    documentId,
    broadcastChanges,
    documentState,
    resolveFromEditor,
  }) => {
    if (!snapshot?.runtimeRef?.rawId) return;

    const existingComment = commentsList.value.find((comment) => {
      if (!comment?.trackedChange) return false;
      const commentAnchorKey = comment.trackedChangeAnchorKey != null ? String(comment.trackedChangeAnchorKey) : null;
      if (commentAnchorKey && snapshot.anchorKey) {
        return commentAnchorKey === snapshot.anchorKey;
      }

      if (commentAnchorKey || snapshot.anchorKey) return false;
      return comment.commentId === snapshot.runtimeRef.rawId || comment.importedId === snapshot.runtimeRef.rawId;
    });

    const params = buildStoryTrackedChangeParams({
      editor,
      snapshot,
      documentId,
      event: existingComment ? 'update' : 'add',
      resolveFromEditor,
    });

    handleTrackedChangeUpdate({ superdoc, params, broadcastChanges, documentState });

    if (existingComment) {
      existingComment.trackedChangeStory = snapshot.story;
      existingComment.trackedChangeStoryKind = snapshot.storyKind;
      existingComment.trackedChangeStoryLabel = snapshot.storyLabel;
      existingComment.trackedChangeAnchorKey = snapshot.anchorKey;
    }
  };

  const normalizeDocxSchemaForExport = (value) => {
    if (!value) return [];
    const nodes = Array.isArray(value) ? value : [value];
    return nodes.filter(Boolean);
  };

  const translateCommentsForExport = () => {
    const processedComments = [];
    commentsList.value.forEach((comment) => {
      const values = comment.getValues();
      const richText = values.commentText;
      // If this comment originated from DOCX (Word or Google Docs), prefer the
      // original DOCX-schema JSON captured at import time. Otherwise, fall back
      // to rebuilding commentJSON from the rich-text HTML.
      const docxSchema = normalizeDocxSchemaForExport(values.docxCommentJSON);
      const schema = docxSchema.length ? docxSchema : convertHtmlToSchema(richText);
      processedComments.push({
        ...values,
        commentJSON: schema,
      });
    });
    return processedComments;
  };

  const convertHtmlToSchema = (commentHTML) => {
    const editor = new Editor({
      mode: 'text',
      isHeadless: true,
      content: commentHTML,
      extensions: getRichTextExtensions(),
    });
    const json = editor.getJSON();
    return Array.isArray(json?.content) ? json.content.filter(Boolean) : [];
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

    const findTrackedChangePosition = (comment, positions) => {
      for (const aliasId of getCommentAliasIds(comment)) {
        const entry = positions[aliasId];
        if (entry !== undefined && positionEntryMatchesTrackedChangeStory(entry, comment)) return entry;
      }
      return null;
    };

    const writeTrackedChangeAliases = (entry, comment, extraKeys = []) => {
      const keys = [...getCommentAliasIds(comment), ...extraKeys.map((id) => normalizeCommentId(id)).filter(Boolean)];
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
      if (retainedTrackedChangeIds && !getCommentAliasIds(comment).some((id) => retainedTrackedChangeIds.has(id))) {
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

  /**
   * Identify the single structural (whole-table) bubble for a tracked table so
   * it is NEVER suppressed by the table-subsume filter below. The structural
   * bubble is the parent "Added table" / "Deleted table" change; its public
   * id is `word:structural:<id>` (or a bare structural fallback) and its display
   * type is `tableInsert` / `tableDelete`.
   *
   * @param {Object} comment
   * @returns {boolean}
   */
  const isStructuralTableBubble = (comment) => {
    if (!comment?.trackedChange) return false;
    const displayType = comment?.trackedChangeDisplayType;
    if (displayType === 'tableInsert' || displayType === 'tableDelete') return true;
    const ids = [comment?.commentId, comment?.importedId, comment?.trackedChangeAnchorKey]
      .map((id) => (id != null ? String(id) : ''))
      .filter(Boolean);
    return ids.some((id) => id.includes('word:structural:'));
  };

  /**
   * Compute the decidable whole-table tracked-change ranges for a comment's
   * document, memoized per editor state so the filter does not re-enumerate the
   * document once per comment. Returns `[]` when the document has no tracked
   * whole-table change (the common case), so non-tracked tables and inline-only
   * tracked changes are never affected.
   *
   * @param {string | null | undefined} fileId
   * @returns {Array<{ from: number, to: number }>}
   */
  const trackedTableSummaryCache = new WeakMap();

  /**
   * Single source of truth for the decidable whole-table tracked changes in an
   * editor state, enumerated and memoized ONCE per state. Returns:
   *  - `ranges`: each tracked whole-table's `{ from, to }` document span. Used to
   *    test whether an inline tracked change falls inside a tracked table.
   *  - `ids`: every change id associated with those tables (the change's public
   *    id / revisionId / revisionGroupId / sourceId plus each row's trackChange
   *    id / sourceId). Text typed inside a tracked-inserted row inherits that
   *    row's revision id, so such an inline change reports a changeId that is one
   *    of these — it must be subsumed by the structural bubble, not get its own
   *    review item.
   *
   * @param {object | null | undefined} state
   * @returns {{ ranges: Array<{ from: number, to: number }>, ids: Set<string> }}
   */
  const computeTrackedTableSummaryForState = (state) => {
    if (!state) return { ranges: [], ids: new Set() };

    const cached = trackedTableSummaryCache.get(state);
    if (cached) return cached;

    const ranges = [];
    const ids = new Set();
    const add = (value) => {
      if (value != null && value !== '') ids.add(String(value));
    };

    const enumerate = trackChangesHelpers?.enumerateStructuralRowChanges;
    if (typeof enumerate === 'function') {
      let structuralChanges = [];
      try {
        structuralChanges = enumerate(state) ?? [];
      } catch {
        structuralChanges = [];
      }
      for (const change of structuralChanges) {
        if (!change?.decidable || !change?.wholeTable) continue;
        const from = Number(change.tableFrom);
        const to = Number(change.tableTo);
        if (Number.isFinite(from) && Number.isFinite(to)) ranges.push({ from, to });
        add(change.id);
        add(change.revisionId);
        add(change.revisionGroupId);
        add(change.sourceId);
        for (const row of change.rows || []) {
          const tc = row?.node?.attrs?.trackChange;
          add(tc?.id);
          add(tc?.sourceId);
        }
      }
    }

    const summary = { ranges, ids };
    trackedTableSummaryCache.set(state, summary);
    return summary;
  };

  const getTrackedTableRangesForDocument = (fileId) => {
    const doc = superdocStore.getDocument(fileId);
    const editor = doc?.getEditor?.();
    return computeTrackedTableSummaryForState(editor?.state).ranges;
  };

  /**
   * True when every `{ from, to }` range of an inline tracked change is wholly
   * contained within some decidable whole-table tracked-change range. Such an
   * inline change is subsumed by the structural "Inserted/Deleted table" review
   * item and must NOT become an independent review item (no comment object →
   * no floating bubble and no active-on-click dialog). The underlying
   * trackInsert/trackDelete mark (the green highlight) is untouched — only the
   * review-item comment is suppressed.
   *
   * @param {Array<{ from?: number, to?: number }>} changeRanges
   * @param {Array<{ from: number, to: number }>} tableRanges
   * @returns {boolean}
   */
  const isInlineRangeInsideTrackedTable = (changeRanges, tableRanges) => {
    if (!tableRanges?.length || !changeRanges?.length) return false;
    return changeRanges.every((seg) => {
      const start = Number(seg?.from);
      const end = Number(seg?.to);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return tableRanges.some((table) => start >= table.from && end <= table.to);
    });
  };

  /**
   * Suppress an inline tracked-change bubble whose document range falls within a
   * tracked whole-table change's range, so only the structural "Added table"
   * / "Deleted table" bubble shows for that table (matching Word / Google Docs).
   * The structural bubble itself, real user comments, and inline tracked changes
   * inside a NON-tracked table are never suppressed.
   *
   * @param {Object} comment
   * @returns {boolean} True when the bubble must NOT render.
   */
  const isInlineTrackedChangeInsideTrackedTable = (comment) => {
    // Only inline TRACKED-CHANGE bubbles are candidates. Real user comments and
    // the structural table bubble are always kept.
    if (!comment?.trackedChange) return false;
    if (isStructuralTableBubble(comment)) return false;

    const ranges = getTrackedTableRangesForDocument(comment?.fileId);
    if (!ranges.length) return false;

    const entry = resolveCommentPositionEntry(comment).entry;
    const range = getCommentPositionRange(entry);
    if (!range) return false;

    return ranges.some((table) => range.start >= table.from && range.end <= table.to);
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
      })
      // Coalesce a tracked whole-table change into ONE bubble: an inline
      // tracked-change bubble inside a tracked inserted/deleted table is
      // subsumed by the structural bubble and must not render.
      .filter((c) => !isInlineTrackedChangeInsideTrackedTable(c));
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

  /**
   * Get HTML content from the comment text JSON (which uses DOCX schema)
   *
   * @param {Object} commentTextJson The comment text JSON
   * @returns {string} The HTML content
   */
  const normalizeCommentForEditor = (node) => {
    if (Array.isArray(node)) {
      return node
        .map((child) => normalizeCommentForEditor(child))
        .flat()
        .filter(Boolean);
    }

    if (!node || typeof node !== 'object') return node;

    const stripTextStyleAttrs = (attrs) => {
      if (!attrs) return attrs;
      const rest = { ...attrs };
      delete rest.fontSize;
      delete rest.fontFamily;
      delete rest.eastAsiaFontFamily;
      return Object.keys(rest).length ? rest : undefined;
    };

    const normalizeMark = (mark) => {
      if (!mark) return mark;
      const typeName = typeof mark.type === 'string' ? mark.type : mark.type?.name;
      const attrs = mark?.attrs ? { ...mark.attrs } : undefined;
      if (typeName === 'textStyle' && attrs) {
        return { ...mark, attrs: stripTextStyleAttrs(attrs) };
      }
      return { ...mark, attrs };
    };

    const cloneMarks = (marks) =>
      Array.isArray(marks) ? marks.filter(Boolean).map((mark) => normalizeMark(mark)) : undefined;

    const cloneAttrs = (attrs) => (attrs && typeof attrs === 'object' ? { ...attrs } : undefined);

    if (!Array.isArray(node.content)) {
      return {
        type: node.type,
        ...(node.text !== undefined ? { text: node.text } : {}),
        ...(node.attrs ? { attrs: cloneAttrs(node.attrs) } : {}),
        ...(node.marks ? { marks: cloneMarks(node.marks) } : {}),
      };
    }

    const normalizedChildren = node.content
      .map((child) => normalizeCommentForEditor(child))
      .flat()
      .filter(Boolean);

    if (node.type === 'run') {
      return normalizedChildren;
    }

    return {
      type: node.type,
      ...(node.attrs ? { attrs: cloneAttrs(node.attrs) } : {}),
      ...(node.marks ? { marks: cloneMarks(node.marks) } : {}),
      content: normalizedChildren,
    };
  };

  const getHtmlFromComment = (commentTextElements) => {
    // If no content, we can't convert and its not a valid comment
    const elementsArray = Array.isArray(commentTextElements)
      ? commentTextElements
      : commentTextElements
        ? [commentTextElements]
        : [];
    const hasContent = elementsArray.some((element) => element?.content?.length);
    if (!hasContent) return;

    try {
      const normalizedContent = normalizeCommentForEditor(elementsArray);
      const contentArray = Array.isArray(normalizedContent)
        ? normalizedContent
        : normalizedContent
          ? [normalizedContent]
          : [];
      if (!contentArray.length) return null;
      const editor = new Editor({
        mode: 'text',
        isHeadless: true,
        content: {
          type: 'doc',
          content: contentArray,
        },
        loadFromSchema: true,
        extensions: getRichTextExtensions(),
      });
      return editor.getHTML();
    } catch (error) {
      console.warn('Failed to convert comment', error);
      return;
    }
  };

  return {
    COMMENT_EVENTS,
    isDebugging,
    hasInitializedComments,
    hasSyncedCollaborationComments,
    editingCommentId,
    activeComment,
    activeFloatingCommentInstanceId,
    commentDialogs,
    overlappingComments,
    overlappedIds,
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
    sortedConversations,
    visibleConversations,
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
    getCommentsByPosition,
    getFloatingComments,
    getFloatingCommentInstances,
    getCommentAliasIds,
    getTrackedChangeThread,
    getCommentPositionKey,
    getCommentPosition,
    getCommentAnchoredText,
    getCommentAnchorData,
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
    getCommentLocation,
    hasOverlapId,
    getPendingComment,
    showAddComment,
    addComment,
    addHydratedComment,
    cancelComment,
    deleteComment,
    removePendingComment,
    cancelImportedTrackedChangeBootstrap,
    removeCommentsForDocument,
    setReviewDirectoryFromV2,
    clearReviewDirectory,
    processLoadedDocxComments,
    translateCommentsForExport,
    handleEditorLocationsUpdate,
    clearEditorCommentPositions,
    handleTrackedChangeUpdate,
    refreshTrackedChangeCommentsByIds,
    syncResolvedCommentsWithDocument,
    syncTrackedChangePositionsWithDocument,
    setActiveFloatingCommentInstance,
    requestInstantSidebarAlignment,
    peekInstantSidebarAlignment,
    clearInstantSidebarAlignment,
    syncTrackedChangeComments,
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
