<script lang="ts">
type CommentEditSession = { owner: object; submission: symbol | null };
type CommentReplySession = { owner: object };

// The shared composer can move between dialog instances while a mutation settles.
const commentEditSessions = new WeakMap<object, CommentEditSession>();
const commentReplySessions = new WeakMap<object, CommentReplySession>();
</script>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import type { ComponentPublicInstance, PropType, Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useSuperDocInstance } from '../../composables/use-superdoc-instance';
import type { SuperDoc } from '../../core/SuperDoc.js';
import type { Editor, User } from '../../core/types/index.js';
import { useCommentsStore } from '../../stores/comments-store';
import { useSuperdocStore } from '../../stores/superdoc-store';
import { superdocIcons } from '../../icons.js';
import {
  getPreferredCommentFocusTargetClientY,
  getVisibleThreadAnchorClientY,
  getVisibleThreadHighlightClientY,
  scrollThreadAnchorToFocusTarget,
} from '../../helpers/comment-focus.js';
import InternalDropdown from './InternalDropdown.vue';
import CommentHeader from './CommentHeader.vue';
import CommentInput from './CommentInput.vue';
import { COMMENT_RECONCILIATION_TOKEN, type CommentModel } from './use-comment';
import Avatar from '../general/Avatar.vue';
import { renderCommentHtml } from './comment-urls.js';
import { isFiniteNumber } from '../../helpers/is-finite-number.js';

type PositionBounds = { top?: number; left?: number; right?: number; bottom?: number };

type PositionEntry = {
  kind?: string;
  storyKey?: string;
  pageIndex?: number | null;
  start?: number;
  end?: number;
  bounds?: PositionBounds | null;
};

type MutationOutcome = {
  ok?: boolean;
  success?: boolean;
  reason?: string | null;
  code?: string;
  detail?: string;
};

type CapabilityState = { canWrite?: boolean; canDecide?: boolean; reason?: string | null };

type V2CommentsAdapter = {
  documentId?: string | null;
  focusComment(comment: CommentModel): Promise<MutationOutcome | undefined>;
  getCapabilityState?(command: string | null): CapabilityState | null | undefined;
};

type V2TrackedChangesAdapter = {
  focusTrackedChange(
    target: CommentModel | Record<string, unknown> | string | null | undefined,
  ): Promise<MutationOutcome | undefined>;
  getCapabilityState?(): CapabilityState | null | undefined;
};

type V2Host = { subscribe?(listener: () => void): (() => void) | undefined };

type LegacyCommentCommands = {
  setCursorById(id: string | undefined, options?: { activeCommentId?: string }): boolean;
  setActiveComment(options: { commentId: string | undefined }): unknown;
};

type DialogEditor = Editor & {
  documentId?: string;
  commands?: LegacyCommentCommands | null;
  host?: V2Host | null;
};

type V2TrackedChangeCommentTarget = {
  kind: 'trackedChange';
  trackedChangeId: string;
  story?: CommentModel['trackedChangeStory'];
  side?: 'source' | 'destination';
};

type TrackedChangeBubbleHandler = (comment: CommentModel, editor: Editor | null) => void;

type DialogSuperDocConfig = SuperDoc['config'] & {
  onTrackedChangeBubbleAccept?: TrackedChangeBubbleHandler;
  onTrackedChangeBubbleReject?: TrackedChangeBubbleHandler;
};

type CommentsHost = Parameters<CommentModel['setIsInternal']>[0]['superdoc'];

type DialogSuperDoc = Pick<SuperDoc, 'interactionConfig' | 'on' | 'off' | 'focus'> & {
  emit: CommentsHost['emit'];
  activeEditor: DialogEditor | null;
  config: DialogSuperDocConfig;
  users: Array<User & { access?: string | { role?: string } | null }>;
};

type DialogComponentProxy = ComponentPublicInstance & { $superdoc: DialogSuperDoc };

type FocusableInput = { focus?: (options?: FocusOptions) => void };

type ClickOutsideEvent = MouseEvent & { target: Node & Partial<Pick<Element, 'closest'>> };

type TrackedChangeDecision = 'accept' | 'reject';

type TrackedChangeDecisionFailure = { decision: TrackedChangeDecision; reason: string | null };

type DialogCommentsStore = {
  addComment(params: { superdoc: DialogSuperDoc; comment: CommentModel }): Promise<MutationOutcome> | MutationOutcome;
  cancelComment(superdoc: DialogSuperDoc): void;
  deleteComment(params: {
    superdoc: DialogSuperDoc;
    commentId: string | undefined;
  }): Promise<MutationOutcome> | MutationOutcome;
  getCommentAliasIds(commentOrId: CommentModel | string): Array<string | null>;
  getCommentDocumentId(comment: CommentModel): string | null;
  removePendingComment(superdoc: DialogSuperDoc): void;
  requestInstantSidebarAlignment(targetY?: number | null, threadId?: string | null, instanceId?: string | null): void;
  resolveCommentPositionEntry(commentOrId: CommentModel | string): {
    key: string | null;
    entry: PositionEntry | null;
  };
  clearInstantSidebarAlignment(): void;
  setActiveFloatingCommentInstance(instanceId?: string | null): void;
  getTrackedChangeThread(parentComment: CommentModel): readonly CommentModel[];
  getComment(id: string): Record<string, unknown> | null | undefined;
  setActiveComment(superdoc: DialogSuperDoc, id: string | null | undefined): void;
  getPendingComment(params: {
    documentId?: string | null;
    isInternal?: boolean;
    parentCommentId?: string | null;
    selection?: ReturnType<CommentModel['selection']['getValues']>;
  }): CommentModel;
  replyCommentV2(params: {
    superdoc: DialogSuperDoc;
    parentCommentId: string | null;
    text: string;
    mentions?: CommentModel['mentions'];
    trackedChangeTarget?: V2TrackedChangeCommentTarget;
  }): Promise<MutationOutcome>;
  editCommentV2(params: {
    superdoc: DialogSuperDoc;
    commentId: string | undefined;
    text: string;
  }): Promise<MutationOutcome>;
  resolveCommentV2(params: { superdoc: DialogSuperDoc; commentId: string | undefined }): Promise<MutationOutcome>;
  reopenCommentV2(params: { superdoc: DialogSuperDoc; commentId: string | undefined }): Promise<MutationOutcome>;
  decideTrackedChangeFromSidebar(params: {
    superdoc: DialogSuperDoc;
    comment: CommentModel;
    decision: TrackedChangeDecision;
  }): Promise<MutationOutcome> | MutationOutcome;
  commentsList: CommentModel[];
  lastUpdate?: Date;
  viewingVisibility: { documentMode: string };
};

type DialogCommentsStoreRefs = {
  suppressInternalExternal: Ref<boolean>;
  getConfig: Ref<{ readOnly: boolean; allowResolve: boolean }>;
  activeComment: Ref<string | null | undefined>;
  activeFloatingCommentInstanceId: Ref<string | null>;
  floatingCommentsOffset: Ref<number>;
  pendingComment: Ref<CommentModel | null>;
  currentCommentText: Ref<string>;
  currentCommentMentions: Ref<CommentModel['mentions']>;
  editingCommentId: Ref<string | null | undefined>;
  editorCommentPositions: Ref<Record<string, PositionEntry | undefined>>;
  isCommentHighlighted: Ref<boolean>;
};

const emit = defineEmits<{
  'click-outside': [];
  ready: [payload: { commentId: string | null | undefined; elementRef: Ref<HTMLElement | null> }];
  'dialog-exit': [];
  resize: [];
}>();
const props = defineProps({
  comment: {
    type: Object as PropType<CommentModel>,
    required: true,
  },
  autoFocus: {
    type: Boolean,
    default: false,
  },
  parent: {
    type: Object as PropType<HTMLElement | null>,
    required: false,
  },
  floatingInstanceId: {
    type: String as PropType<string | null>,
    default: null,
  },
  floatingPageIndex: {
    type: Number as PropType<number | null>,
    default: null,
  },
  floatingPositionEntry: {
    type: Object as PropType<PositionEntry | null>,
    default: null,
  },
  isFloatingInstanceActive: {
    type: Boolean as PropType<boolean | undefined>,
    default: undefined,
  },
  threadComments: {
    type: Array as PropType<CommentModel[] | null>,
    default: null,
  },
});

const proxy = useSuperDocInstance().proxy as DialogComponentProxy;
const superdocStore = useSuperdocStore();
const piniaCommentsStore = useCommentsStore();
const commentsStore: DialogCommentsStore = piniaCommentsStore;
const editSessionOwner = {};
const replySessionOwner = {};
const retireOwnEditSession = () => {
  if (commentEditSessions.get(commentsStore)?.owner === editSessionOwner) {
    commentEditSessions.delete(commentsStore);
  }
};
const retireOwnReplySession = () => {
  if (commentReplySessions.get(commentsStore)?.owner === replySessionOwner) {
    commentReplySessions.delete(commentsStore);
  }
};

/* Comments store refs */
const {
  addComment,
  cancelComment,
  deleteComment,
  getCommentAliasIds,
  removePendingComment,
  getCommentDocumentId,
  requestInstantSidebarAlignment,
  resolveCommentPositionEntry,
  clearInstantSidebarAlignment,
  setActiveFloatingCommentInstance,
} = commentsStore;
const {
  suppressInternalExternal,
  getConfig,
  activeComment,
  activeFloatingCommentInstanceId,
  floatingCommentsOffset,
  pendingComment,
  currentCommentText,
  currentCommentMentions,
  editingCommentId,
  editorCommentPositions,
  isCommentHighlighted,
}: DialogCommentsStoreRefs = storeToRefs(piniaCommentsStore);

const isInternal = ref(true);
const commentInput = ref<FocusableInput | null>(null);
const editCommentInputs = ref(new Map<string, FocusableInput>());
// SD-3772 §6: a rejected tracked-change decision must be visible. The row is
// retained and focus stays where it is, so the card owns a `[role="alert"]`
// with a retry affordance instead of silently swallowing the failure.
// Shape: { decision: 'accept' | 'reject', reason: string | null } or null.
const trackedChangeDecisionFailure = ref<TrackedChangeDecisionFailure | null>(null);
const CLICK_OUTSIDE_HIT_TOLERANCE_PX = 3;
const CLICK_OUTSIDE_HIT_SAMPLE_OFFSETS = [
  [0, 0],
  [-CLICK_OUTSIDE_HIT_TOLERANCE_PX, 0],
  [CLICK_OUTSIDE_HIT_TOLERANCE_PX, 0],
  [0, -CLICK_OUTSIDE_HIT_TOLERANCE_PX],
  [0, CLICK_OUTSIDE_HIT_TOLERANCE_PX],
];
const TRACKED_CHANGE_PREVIEW_MAX_PX = 90;

const trackedChangeImagePreviewStyle = (preview: CommentModel['trackedChangeImagePreview']) => {
  const width = isFiniteNumber(preview?.width) ? preview.width : null;
  const height = isFiniteNumber(preview?.height) ? preview.height : null;
  if (!width || !height || width <= 0 || height <= 0) return {};
  const scale = Math.min(TRACKED_CHANGE_PREVIEW_MAX_PX / width, TRACKED_CHANGE_PREVIEW_MAX_PX / height, 1);
  return {
    width: `${Math.max(1, Math.round(width * scale))}px`,
    height: `${Math.max(1, Math.round(height * scale))}px`,
  };
};
const CLICK_OUTSIDE_IGNORED_SELECTORS = [
  '.superdoc__tools [data-id="is-tool"]',
  '.comments-dropdown__option-label',
  '.comments-dropdown__menu',
  '.comments-dropdown__option',
  '.comments-dropdown__option-icon',
  '.comments-dropdown__trigger',
  '.superdoc-comment-highlight',
  '.sd-editor-comment-highlight',
  '.sd-editor-tracked-change-highlight',
  '[data-track-change-id]',
  '.track-insert',
  '.track-insert-dec',
  '.track-delete',
  '.track-delete-dec',
  '.track-format',
  '.track-format-dec',
].join(',');

const setEditCommentInputRef = (commentId: string | undefined) => (el: Element | ComponentPublicInstance | null) => {
  if (!commentId) return;
  if (el) {
    editCommentInputs.value.set(commentId, el as FocusableInput);
    if (editingCommentId.value === commentId) {
      nextTick(() => {
        focusEditInput(commentId);
      });
    }
  } else {
    editCommentInputs.value.delete(commentId);
  }
};

const elementContainsClickPoint = (element: HTMLElement, clientX: number, clientY: number) => {
  const rect = element?.getBoundingClientRect?.();
  if (
    !rect ||
    ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return false;
  }

  return CLICK_OUTSIDE_HIT_SAMPLE_OFFSETS.some(([offsetX, offsetY]) => {
    const sampleX = clientX + offsetX;
    const sampleY = clientY + offsetY;
    return sampleX >= rect.left && sampleX <= rect.right && sampleY >= rect.top && sampleY <= rect.bottom;
  });
};

const findIgnoredElementByGeometry = (clientX: number, clientY: number) => {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  const ignoredElements = document.querySelectorAll(CLICK_OUTSIDE_IGNORED_SELECTORS);
  for (const element of Array.from(ignoredElements)) {
    if (element instanceof HTMLElement && elementContainsClickPoint(element, clientX, clientY)) {
      return element;
    }
  }

  return null;
};

const focusEditInput = (commentId: string) => {
  const input = editCommentInputs.value.get(commentId);
  input?.focus?.();
};
const commentDialogElement = ref<HTMLElement | null>(null);

const trackedChangeStoryType = (story: CommentModel['trackedChangeStory']) =>
  typeof story === 'object' ? story?.storyType : undefined;

const getCommentFocusThreadId = (comment: CommentModel) => {
  if (comment.resolvedTime) {
    return comment.commentId;
  }

  return comment.importedId || comment.commentId;
};

const getV2ExistingReplyParentId = (comment: CommentModel | null | undefined) => {
  if (!comment) return null;
  if (comment.trackedChange && comment.trackedChangeCanonicalId != null) {
    return String(comment.trackedChangeCanonicalId);
  }
  if (comment.commentId != null) return String(comment.commentId);
  return null;
};

const getV2TrackedChangeCommentTarget = (comment: CommentModel) => {
  if (!comment?.trackedChange) return null;
  const trackedChangeId = getV2ExistingReplyParentId(comment);
  if (!trackedChangeId) return null;

  const target: V2TrackedChangeCommentTarget = { kind: 'trackedChange', trackedChangeId };
  if (comment.trackedChangeStory) target.story = comment.trackedChangeStory;
  if (comment.semanticColorKey === 'move-from') target.side = 'source';
  if (comment.semanticColorKey === 'move-to') target.side = 'destination';
  return target;
};

const getEntryBoundsCoordinate = (entry: PositionEntry | null | undefined, coordinate: keyof PositionBounds) => {
  const value = entry?.bounds?.[coordinate];
  return isFiniteNumber(value) ? value : null;
};

const entriesShareLine = (
  entry: PositionEntry | null | undefined,
  candidateEntry: PositionEntry | null | undefined,
) => {
  if (!entry || !candidateEntry) return false;
  if (entry.pageIndex !== candidateEntry.pageIndex) return false;

  const entryTop = getEntryBoundsCoordinate(entry, 'top');
  const candidateTop = getEntryBoundsCoordinate(candidateEntry, 'top');

  return entryTop != null && candidateTop != null && Math.abs(entryTop - candidateTop) < 0.5;
};

const entriesOverlapHorizontalSpan = (
  entry: PositionEntry | null | undefined,
  candidateEntry: PositionEntry | null | undefined,
) => {
  const entryLeft = getEntryBoundsCoordinate(entry, 'left');
  const candidateLeft = getEntryBoundsCoordinate(candidateEntry, 'left');
  const entryRight = getEntryBoundsCoordinate(entry, 'right');
  const candidateRight = getEntryBoundsCoordinate(candidateEntry, 'right');

  if (entryLeft == null || candidateLeft == null || entryRight == null || candidateRight == null) {
    return false;
  }

  return candidateLeft < entryRight && entryLeft < candidateRight;
};

const entriesOverlapRange = (
  entry: PositionEntry | null | undefined,
  candidateEntry: PositionEntry | null | undefined,
) => {
  const entryStart = entry?.start;
  const entryEnd = entry?.end;
  const candidateStart = candidateEntry?.start;
  const candidateEnd = candidateEntry?.end;

  if (
    !isFiniteNumber(entryStart) ||
    !isFiniteNumber(entryEnd) ||
    !isFiniteNumber(candidateStart) ||
    !isFiniteNumber(candidateEnd)
  ) {
    return false;
  }

  return candidateStart <= entryEnd && entryStart <= candidateEnd;
};

const shouldIncludeThreadAlias = (
  entry: PositionEntry | null | undefined,
  candidateEntry: PositionEntry | null | undefined,
) => {
  if (!entry || !candidateEntry) return false;
  if (entry.kind && candidateEntry.kind && entry.kind !== candidateEntry.kind) return false;
  if (entry.storyKey && candidateEntry.storyKey && entry.storyKey !== candidateEntry.storyKey) return false;
  if (candidateEntry.start === entry.start && candidateEntry.end === entry.end) return true;
  return (
    entriesShareLine(entry, candidateEntry) &&
    entriesOverlapHorizontalSpan(entry, candidateEntry) &&
    entriesOverlapRange(entry, candidateEntry)
  );
};

// One logical thread can surface under multiple position keys when tracked-change
// anchors are split across imported ids and canonical ids. Collect every matching
// key so the visible highlight lookup stays aligned with the actual rendered text.
const getThreadHighlightLookupIds = (commentOrId: CommentModel) => {
  const lookupIds = new Set(getCommentAliasIds(commentOrId));
  const { key, entry } = resolveCommentPositionEntry(commentOrId);

  if (key) {
    lookupIds.add(key);
  }

  if (!entry) {
    return [...lookupIds];
  }

  Object.entries(editorCommentPositions.value ?? {}).forEach(([id, candidateEntry]) => {
    if (shouldIncludeThreadAlias(entry, candidateEntry)) {
      lookupIds.add(id);
    }
  });

  return [...lookupIds];
};

const isDialogAlreadyAlignedWithTarget = (
  dialogElement: HTMLElement | null,
  targetClientY: number | null,
  tolerancePx = 24,
) => {
  if (!isFiniteNumber(targetClientY) || typeof dialogElement?.getBoundingClientRect !== 'function') {
    return false;
  }

  const dialogTop = dialogElement.getBoundingClientRect().top;
  return Number.isFinite(dialogTop) && Math.abs(dialogTop - targetClientY) <= tolerancePx;
};

const currentFloatingInstanceId = computed(() => {
  return props.floatingInstanceId ?? props.comment.commentId ?? null;
});

const isDialogActive = computed(() => {
  if (typeof props.isFloatingInstanceActive === 'boolean') {
    return props.isFloatingInstanceActive;
  }

  if (activeComment.value !== props.comment.commentId) {
    return false;
  }

  if (props.floatingInstanceId == null) {
    return true;
  }

  return activeFloatingCommentInstanceId.value === props.floatingInstanceId;
});

/* ── Step 1: Resolved badge ── */
const resolvedBadgeLabel = computed(() => {
  if (!props.comment.resolvedTime) return null;
  if (!props.comment.trackedChange) return 'Resolved';
  return props.comment.trackedChangeDecision === 'reject' ? 'Rejected' : 'Accepted';
});

/* ── Pending new comment (brand-new, not a reply) ── */
const isPendingNewComment = computed(() => {
  return pendingComment.value && pendingComment.value.commentId === props.comment.commentId;
});

const showSeparator = computed(() => (index: number) => {
  const visible = visibleComments.value;
  if (showInputSection.value && index === visible.length - 1) return true;
  return visible.length > 1 && index !== visible.length - 1;
});

const commentsAreReadOnly = () => getConfig.value?.readOnly === true;
const resolveIsDisabled = () => getConfig.value?.allowResolve === false;

const showInputSection = computed(() => {
  return !commentsAreReadOnly() && isDialogActive.value && !props.comment.resolvedTime && !isEditingAnyComment.value;
});

const readOnlyMutationOutcome = () => ({ ok: false, reason: 'read-only-document' });
const resolveDisabledOutcome = () => ({ ok: false, reason: 'resolve-disabled' });
const trackedChangeDecisionsAreDisabled = () => {
  const allowDecisions = proxy.$superdoc?.interactionConfig?.trackedChanges?.allowDecisions;
  if (typeof allowDecisions === 'boolean') return !allowDecisions;
  return commentsAreReadOnly();
};
const trackedChangeDecisionDisabledOutcome = () => ({
  ok: false,
  reason: commentsAreReadOnly() ? 'read-only-document' : 'tracked-change-decisions-disabled',
});

// Reply pill → expanded editor toggle
const isReplying = ref(false);
const isSubmittingReply = ref(false);
const isSubmittingNewComment = ref(false);
let replyDraftRevision = 0;
watch([currentCommentText, currentCommentMentions], () => replyDraftRevision++, { deep: true, flush: 'sync' });
const commentSaveFailure = ref('');
const commentSaveFailureMessage = (outcome?: MutationOutcome, hasDraft = true) => {
  const reason =
    outcome?.detail === 'document-mode-read-only'
      ? ' because the document or connection is read-only'
      : outcome?.code === 'PERMISSION_DENIED'
        ? ' because you do not have permission'
        : '';
  return `Your comment could not be saved${reason}.${hasDraft ? ' Your draft is still here. Try again or cancel.' : ' Try again.'}`;
};
const startReply = () => {
  if (commentsAreReadOnly()) return readOnlyMutationOutcome();
  if (isV2WriteDisabled.value) {
    return { ok: false, reason: v2WriteCapability.value?.reason ?? 'v2-write-unavailable' };
  }
  commentReplySessions.set(commentsStore, { owner: replySessionOwner });
  commentSaveFailure.value = '';
  isReplying.value = true;
  nextTick(() => {
    commentInput.value?.focus?.();
    emit('resize');
  });
};

const comments = computed(() => {
  const parentComment = props.comment;
  if (Array.isArray(props.threadComments)) {
    return [...props.threadComments].sort((a, b) => {
      if (a.commentId === parentComment.commentId) return -1;
      if (b.commentId === parentComment.commentId) return 1;
      return a.createdTime - b.createdTime;
    });
  }
  if (parentComment.trackedChange) {
    return commentsStore.getTrackedChangeThread(parentComment);
  }
  const allComments = commentsStore.commentsList;
  const threadComments = allComments.filter((comment) => {
    const isThreadedComment = comment.parentCommentId === parentComment.commentId;
    const isThisComment = comment.commentId === parentComment.commentId;
    return isThreadedComment || isThisComment;
  });

  return threadComments.sort((a, b) => {
    // Parent comment (the one passed as prop) should always be first
    if (a.commentId === parentComment.commentId) return -1;
    if (b.commentId === parentComment.commentId) return 1;
    // Sort remaining comments (children) by creation time
    return a.createdTime - b.createdTime;
  });
});

const renderedCommentTexts = computed(
  () => new Map(comments.value.map((comment) => [comment.commentId, renderCommentHtml(comment.commentText)])),
);

const handleDialogClick = (event: MouseEvent) => {
  if (event.target instanceof Element && event.target.closest('.comment a[href]')) return;
  event.preventDefault();
  return setFocus();
};

const dialogAccessibleLabel = computed(() => {
  if (props.comment.trackedChangeLabel) return props.comment.trackedChangeLabel;
  if (props.comment.trackedChange) return 'Tracked change discussion';
  return props.comment.creatorName ? `Comment by ${props.comment.creatorName}` : 'Comment thread';
});

/* ── Step 2: Text truncation ── */
const textExpanded = ref(false);
const parentBodyRef = ref<HTMLElement | null>(null);
const isTextOverflowing = ref(false);
const shouldTruncate = computed(() => !textExpanded.value);
const bodyOverflowClass = computed(() => ({
  'is-truncated': shouldTruncate.value,
  'is-scrollable': textExpanded.value && isTextOverflowing.value,
}));
const toggleTruncation = () => {
  textExpanded.value = !textExpanded.value;
  nextTick(() => emit('resize'));
};
const setParentBodyRef = (el: Element | ComponentPublicInstance | null) => {
  parentBodyRef.value = el as HTMLElement | null;
};
const checkOverflow = () => {
  // Only measure when the clamp is active (initial state)
  if (textExpanded.value) return;
  const el = parentBodyRef.value;
  if (!el) {
    isTextOverflowing.value = false;
    return;
  }
  isTextOverflowing.value = el.scrollHeight > el.clientHeight + 1;
};
// Check overflow when the element first renders
watch(parentBodyRef, () => {
  nextTick(checkOverflow);
});

const isEditingCommentInThisThread = () => {
  if (!editingCommentId.value) return false;
  return comments.value.some((comment) => comment.commentId === editingCommentId.value);
};

// Reset truncation, thread collapse, and reply state when card becomes inactive
watch(isDialogActive, (active) => {
  if (!active) {
    if (isReplying.value || isEditingCommentInThisThread()) {
      currentCommentText.value = '';
      currentCommentMentions.value = [];
      editingCommentId.value = null;
    }
    textExpanded.value = false;
    threadExpanded.value = false;
    isReplying.value = false;
    nextTick(() => emit('resize'));
  }
});

/* ── Step 3: Thread collapse ──
 * >=2 replies → collapse: parent + "N more replies" + last reply
 * <2 replies  → show all
 * Clicking "N more replies" or the card → expand all + activate
 * Deactivating → re-collapse
 */
const threadExpanded = ref(false);
const childComments = computed(() => comments.value.slice(1));

const shouldCollapseThread = computed(() => {
  if (threadExpanded.value) return false;
  return childComments.value.length >= 2;
});

const visibleComments = computed(() => {
  if (!shouldCollapseThread.value) return comments.value;
  // Collapsed: parent + last reply
  const parent = comments.value[0];
  const last = childComments.value[childComments.value.length - 1];
  return [parent, last].filter(Boolean);
});

const overflowMeasurementKey = computed(() => {
  const comment = visibleComments.value[0];
  if (!comment) return '';
  return JSON.stringify({
    commentId: comment.commentId,
    commentText: comment.commentText,
    trackedChange: comment.trackedChange,
    trackedChangeText: comment.trackedChangeText,
    deletedText: comment.deletedText,
    trackedChangeLabel: comment.trackedChangeLabel,
    trackedChangeDisplayType: comment.trackedChangeDisplayType,
    trackedChangeDetailLines: comment.trackedChangeDetailLines,
  });
});

watch(overflowMeasurementKey, () => {
  nextTick(checkOverflow);
});

const collapsedReplyCount = computed(() => {
  if (!shouldCollapseThread.value) return 0;
  return childComments.value.length - 1; // only last is shown
});

const collapsedReplyAuthors = computed(() => {
  if (!shouldCollapseThread.value) return [];
  // Hidden = all replies except last
  const hidden = childComments.value.slice(0, -1);
  const seen = new Set<string | null | undefined>();
  return hidden
    .map((c: CommentModel & { email?: string | null }) =>
      typeof c.getCommentUser === 'function'
        ? c.getCommentUser()
        : { name: c.creatorName, email: c.creatorEmail || c.email },
    )
    .filter((u) => {
      if (!u) return false;
      const key = u.email || u.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
});

const expandThread = () => {
  threadExpanded.value = true;
  setFocus();
  nextTick(() => emit('resize'));
};

const isInternalDropdownDisabled = computed(() => {
  if (props.comment.resolvedTime) return true;
  return commentsAreReadOnly();
});

const isEditingThisComment = computed(() => (comment: CommentModel) => {
  return isDialogActive.value && editingCommentId.value === comment.commentId;
});

const isEditingAnyComment = computed(() => {
  if (!editingCommentId.value || !isDialogActive.value) return false;
  return comments.value.some((c) => c.commentId === editingCommentId.value);
});

const shouldShowInternalExternal = computed(() => {
  if (commentsAreReadOnly()) return false;
  if (!proxy.$superdoc.config.isInternal) return false;
  // ui-phase3-002: the v2 host does not model `isInternal` today, so the
  // dropdown would only mutate Vue state without surviving save/reopen.
  // Hide it in v2 mode until a v2 internal/external surface ships.
  if (isV2Mode.value) return false;
  return !suppressInternalExternal.value && !props.comment.trackedChange;
});

const hasTextContent = computed(() => {
  return Boolean(currentCommentText.value?.replace(/<[^>]*>/g, '').trim());
});

const setFocus = async () => {
  const editor = proxy.$superdoc.activeEditor;
  const v2Adapter =
    editor?.editorVersion === 2 ? ((editor?.v2Comments as V2CommentsAdapter | null | undefined) ?? null) : null;
  const isTrackedChange = Boolean(props.comment?.trackedChange);
  const targetClientY = getPreferredCommentFocusTargetClientY();
  const isInstanceScopedDialog = props.floatingInstanceId != null;
  const willChangeActiveDialog =
    !props.comment.resolvedTime &&
    (activeComment.value !== props.comment.commentId ||
      (isInstanceScopedDialog && currentFloatingInstanceId.value !== activeFloatingCommentInstanceId.value));
  let instantAlignmentTargetY = targetClientY;

  // In v2 mode, all setFocus work routes through the v2 comments adapter.
  // Legacy DocumentRendererRuntime cursor APIs are not part of superdoc@2.
  if (v2Adapter) {
    // Tracked-change rows and ordinary comments spatially linked to a tracked
    // change focus the painted [data-track-change-id] carrier. The ordinary
    // comment remains the active sidebar card below.
    const linkedTrackedChangeId =
      !isTrackedChange && !props.comment.resolvedTime && String(props.comment?.trackedChangeParentId ?? '').trim()
        ? props.comment.trackedChangeParentId
        : null;
    const trackedChangeAdapter =
      editor?.editorVersion === 2 && (isTrackedChange || linkedTrackedChangeId != null)
        ? ((editor?.v2TrackedChanges as V2TrackedChangesAdapter | null | undefined) ?? null)
        : null;
    const linkedTrackedChange = linkedTrackedChangeId != null ? commentsStore.getComment(linkedTrackedChangeId) : null;
    const trackedChangeTarget = isTrackedChange
      ? props.comment
      : linkedTrackedChange?.trackedChange
        ? linkedTrackedChange
        : linkedTrackedChangeId;
    let result = await (trackedChangeAdapter
      ? trackedChangeAdapter.focusTrackedChange(trackedChangeTarget)
      : v2Adapter.focusComment(props.comment));
    if (!isTrackedChange && result?.reason === 'tracked-change-anchor-not-found') {
      result = await v2Adapter.focusComment(props.comment);
    }
    if (!result?.ok) {
      clearInstantSidebarAlignment();
      return result;
    }
    if (!props.comment.resolvedTime) {
      activeComment.value = props.comment.commentId;
      if (props.floatingInstanceId) {
        setActiveFloatingCommentInstance(props.floatingInstanceId);
      }
    }
    if (willChangeActiveDialog && !isInstanceScopedDialog) {
      requestInstantSidebarAlignment(targetClientY, props.comment.commentId, props.floatingInstanceId ?? null);
    } else if (isInstanceScopedDialog && !props.comment.resolvedTime) {
      await nextTick();
      const { entry } = resolveCommentPositionEntry(props.comment);
      const anchorClientY = getVisibleThreadAnchorClientY(props.parent, props.floatingPositionEntry ?? entry);
      if (Number.isFinite(anchorClientY)) {
        requestInstantSidebarAlignment(anchorClientY, props.comment.commentId, props.floatingInstanceId);
      } else {
        clearInstantSidebarAlignment();
      }
    } else {
      clearInstantSidebarAlignment();
    }
    return result;
  }

  // Move cursor to the comment location and set active comment in a single PM
  // transaction. This prevents a race where position-based comment detection in the
  // plugin clears the activeThreadId before the setActiveComment meta is processed.
  if (editor) {
    const { entry: resolvedFocusEntry } = resolveCommentPositionEntry(props.comment);
    const focusEntry = props.floatingPositionEntry ?? resolvedFocusEntry;
    const usePageScopedAnchorOnly =
      Number.isFinite(props.floatingPageIndex) &&
      trackedChangeStoryType(props.comment?.trackedChangeStory) === 'headerFooterPart';
    const visibleAnchorTargetY = getVisibleThreadAnchorClientY(props.parent, focusEntry);
    const visibleHighlightTargetY = usePageScopedAnchorOnly
      ? null
      : getVisibleThreadHighlightClientY(getThreadHighlightLookupIds(props.comment));
    const visibleThreadTargetY = Number.isFinite(visibleHighlightTargetY)
      ? visibleHighlightTargetY
      : visibleAnchorTargetY;
    const shouldSkipFocusScroll = isDialogAlreadyAlignedWithTarget(commentDialogElement.value, visibleThreadTargetY);
    const cursorId = getCommentFocusThreadId(props.comment);
    const presentation = null;
    let reachableTargetY = null;

    if (isTrackedChange) {
      const trackedTarget = props.comment.trackedChangeStory
        ? {
            kind: 'entity',
            entityType: 'trackedChange',
            entityId: cursorId,
            story: props.comment.trackedChangeStory,
            ...(Number.isFinite(props.floatingPageIndex) ? { pageIndex: props.floatingPageIndex } : {}),
          }
        : {
            kind: 'entity',
            entityType: 'trackedChange',
            entityId: cursorId,
          };

      void trackedTarget;
      if (props.comment.resolvedTime) {
        editor.commands?.setCursorById(cursorId);
      } else {
        const activeCommentId = props.comment.commentId;
        const didScroll = editor.commands?.setCursorById(cursorId, { activeCommentId });
        if (!didScroll) {
          editor.commands?.setActiveComment({ commentId: activeCommentId });
        }
      }
    } else {
      if (props.comment.resolvedTime) {
        editor.commands?.setCursorById(cursorId);
      } else {
        const activeCommentId = props.comment.commentId;
        const didScroll = editor.commands?.setCursorById(cursorId, { activeCommentId });
        if (!didScroll) {
          editor.commands?.setActiveComment({ commentId: activeCommentId });
        }
      }

      const fallbackThreadId = props.comment.commentId;
      reachableTargetY = shouldSkipFocusScroll
        ? null
        : scrollThreadAnchorToFocusTarget(presentation, cursorId, fallbackThreadId, targetClientY);
    }
    if (Number.isFinite(visibleHighlightTargetY)) {
      instantAlignmentTargetY = visibleHighlightTargetY;
    } else if (Number.isFinite(visibleAnchorTargetY)) {
      instantAlignmentTargetY = visibleAnchorTargetY;
    } else if (Number.isFinite(reachableTargetY)) {
      instantAlignmentTargetY = reachableTargetY;
    }
  }

  // Keep the floating sidebar aligned with the anchor position the document can
  // actually reach. Near scroll boundaries the preferred focus Y may be impossible
  // to achieve, and using that impossible target would visibly separate the bubble
  // from its highlight.
  if (willChangeActiveDialog && !isInstanceScopedDialog) {
    if (props.floatingInstanceId) {
      requestInstantSidebarAlignment(instantAlignmentTargetY, props.comment.commentId, props.floatingInstanceId);
    } else {
      requestInstantSidebarAlignment(instantAlignmentTargetY, props.comment.commentId);
    }
  } else {
    clearInstantSidebarAlignment();
  }

  // Update Vue store after queuing any one-shot alignment target so the
  // floating sidebar can react to both state changes in the same flush.
  if (!props.comment.resolvedTime) {
    activeComment.value = props.comment.commentId;
    if (props.floatingInstanceId) {
      setActiveFloatingCommentInstance(props.floatingInstanceId);
    }
  }
};

const handleClickOutside = (e: ClickOutsideEvent) => {
  const targetElement = e.target instanceof Element ? e.target : e.target?.parentElement;
  // Also check what's under the actual click coordinates. Pointer capture
  // (used by the presentation editor) can redirect e.target away from the
  // originally clicked element, causing the selector check to miss it.
  const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
  const clickedIgnoredTarget =
    targetElement?.closest?.(CLICK_OUTSIDE_IGNORED_SELECTORS) ||
    elementAtPoint?.closest?.(CLICK_OUTSIDE_IGNORED_SELECTORS) ||
    findIgnoredElementByGeometry(e.clientX, e.clientY);

  if (clickedIgnoredTarget || isCommentHighlighted.value) return;

  // If clicked on another comment dialog, let that dialog's setFocus handle activation.
  // Without this, the outgoing dialog clears activeComment before the new dialog can set it.
  if (e.target.closest?.('.comments-dialog') && !commentDialogElement.value?.contains(e.target)) return;

  // Cancel the pending new comment on click-outside
  if (isPendingNewComment.value) {
    cancelComment(proxy.$superdoc);
    return;
  }

  if (!isDialogActive.value) return;

  floatingCommentsOffset.value = 0;
  emit('dialog-exit');
  activeComment.value = null;
  commentsStore.setActiveComment(proxy.$superdoc, activeComment.value);
  isCommentHighlighted.value = false;
};

const captureCommentEditorOwner = () => {
  const editor = proxy.$superdoc.activeEditor!;
  const adapter = editor.v2Comments as V2CommentsAdapter;
  const document = editor.doc;
  return {
    adapter,
    isCurrent: () =>
      proxy.$superdoc.activeEditor === editor && editor.v2Comments === adapter && editor.doc === document,
  };
};

const handleAddComment = async () => {
  if (commentsAreReadOnly()) return readOnlyMutationOutcome();
  if (isV2WriteDisabled.value) {
    return { ok: false, reason: v2WriteCapability.value?.reason ?? 'v2-write-unavailable' };
  }

  if (isV2Mode.value && v2CommentsAdapter.value && !isPendingNewComment.value) {
    if (isSubmittingReply.value) {
      return { ok: false, reason: 'reply-submit-in-flight' };
    }

    isSubmittingReply.value = true;
    commentSaveFailure.value = '';
    try {
      const session = commentReplySessions.get(commentsStore);
      const draftRevision = replyDraftRevision;
      const editorOwner = captureCommentEditorOwner();
      const threadId = props.comment.commentId;
      const fileId = props.comment.fileId;
      const pendingDraft = pendingComment.value;
      const edit = editingCommentId.value;
      const parentCommentId = getV2ExistingReplyParentId(props.comment);
      const trackedChangeTarget = getV2TrackedChangeCommentTarget(props.comment);
      const outcome = await commentsStore.replyCommentV2({
        superdoc: proxy.$superdoc,
        parentCommentId,
        text: currentCommentText.value,
        ...(currentCommentMentions.value.length ? { mentions: currentCommentMentions.value } : {}),
        ...(trackedChangeTarget ? { trackedChangeTarget } : {}),
      });
      if (!outcome?.ok) {
        commentSaveFailure.value = commentSaveFailureMessage(outcome);
        // Plan §4.1: keep reply editor open and typed text intact for retry.
        nextTick(() => emit('resize'));
        return outcome;
      }
      if (
        session?.owner !== replySessionOwner ||
        commentReplySessions.get(commentsStore) !== session ||
        replyDraftRevision !== draftRevision ||
        !editorOwner.isCurrent() ||
        props.comment.commentId !== threadId ||
        props.comment.fileId !== fileId ||
        pendingComment.value !== pendingDraft ||
        editingCommentId.value !== edit ||
        !isDialogActive.value ||
        !isReplying.value
      )
        return outcome;
      retireOwnReplySession();
      isReplying.value = false;
      currentCommentText.value = '';
      currentCommentMentions.value = [];
      nextTick(() => emit('resize'));
      return outcome;
    } finally {
      isSubmittingReply.value = false;
    }
  }

  // Scoped to isPendingNewComment: this fallthrough is also reached by the
  // legacy (non-v2) reply-to-existing-thread path, which has its own
  // disabled-state handling and must not be silently no-op'd by this flag.
  if (isPendingNewComment.value) {
    if (isSubmittingNewComment.value) {
      return { ok: false, reason: 'comment-submit-in-flight' };
    }
    isSubmittingNewComment.value = true;
    commentSaveFailure.value = '';
  }

  const options: Parameters<DialogCommentsStore['getPendingComment']>[0] = {
    documentId: props.comment.fileId,
    isInternal: pendingComment.value ? pendingComment.value.isInternal : isInternal.value,
    parentCommentId: pendingComment.value ? null : props.comment.commentId,
  };

  if (pendingComment.value) {
    const selection = pendingComment.value.selection.getValues();
    options.selection = selection;
  }

  const comment = commentsStore.getPendingComment(options);
  // ui-phase3-002: pre-populate the new comment's text from the current
  // input so the v2 path can read the value off the comment model itself
  // (the v2 dispatch happens before Vue state mutation, so the store cannot
  // rely on commentText being attached later).
  if (!pendingComment.value && currentCommentText.value) {
    comment.setText({ text: currentCommentText.value, suppressUpdate: true });
  }
  // Deferred into .then() so a synchronous throw from addComment (e.g. the
  // legacy/v1 branch) rejects instead of escaping before the flag resets.
  Promise.resolve()
    .then(() => addComment({ superdoc: proxy.$superdoc, comment }))
    .then((outcome) => {
      if (isPendingNewComment.value && outcome?.ok === false) {
        commentSaveFailure.value = commentSaveFailureMessage(outcome);
      }
    })
    .catch((err) => {
      commentSaveFailure.value = commentSaveFailureMessage();
      console.error('[SuperDoc] addComment failed', err);
    })
    .finally(() => {
      isSubmittingNewComment.value = false;
      isReplying.value = false;
      nextTick(() => emit('resize'));
    });
};

const activeEditorRevision = ref(0);
const v2CapabilityRevision = ref(0);
const refreshActiveEditor = () => {
  activeEditorRevision.value += 1;
};
const isV2Mode = computed(() => {
  void activeEditorRevision.value;
  return proxy.$superdoc?.activeEditor?.editorVersion === 2;
});
const v2CommentsAdapter = computed(() => {
  void activeEditorRevision.value;
  return isV2Mode.value
    ? ((proxy.$superdoc?.activeEditor?.v2Comments as V2CommentsAdapter | null | undefined) ?? null)
    : null;
});
// ui-phase3-003: v2 tracked-change adapter accessor. Mutation-plane
// consolidation: accept/reject route through the adapter's compatibility
// wrappers, which delegate to `activeEditor.doc.trackChanges.decide(...)`.
const v2TrackedChangesAdapter = computed(() => {
  void activeEditorRevision.value;
  return isV2Mode.value
    ? ((proxy.$superdoc?.activeEditor?.v2TrackedChanges as V2TrackedChangesAdapter | null | undefined) ?? null)
    : null;
});
watch(
  () => {
    void activeEditorRevision.value;
    return isV2Mode.value ? (proxy.$superdoc?.activeEditor?.host ?? null) : null;
  },
  (host, _previous, onCleanup) => {
    v2CapabilityRevision.value += 1;
    const unsubscribe = host?.subscribe?.(() => {
      v2CapabilityRevision.value += 1;
    });
    onCleanup(() => unsubscribe?.());
  },
  { immediate: true },
);
const v2WriteCapability = computed(() => {
  void v2CapabilityRevision.value;
  if (!v2CommentsAdapter.value) return null;
  const command = isPendingNewComment.value ? 'comments.createFromSelection' : null;
  return v2CommentsAdapter.value.getCapabilityState?.(command) ?? null;
});
const isV2WriteDisabled = computed(() => {
  if (!isV2Mode.value) return false;
  const cap = v2WriteCapability.value;
  if (!cap) return false;
  return cap.canWrite === false;
});
const v2ReplyDisabledReason = computed(() => {
  if (isSubmittingReply.value) return 'reply-submit-in-flight';
  if (!isV2WriteDisabled.value) return null;
  return v2WriteCapability.value?.reason ?? 'v2-write-unavailable';
});
const v2TrackedChangeCapability = computed(() => {
  void v2CapabilityRevision.value;
  if (!v2TrackedChangesAdapter.value) return null;
  const documentMode = commentsStore.viewingVisibility.documentMode;
  const capability = v2TrackedChangesAdapter.value.getCapabilityState?.() ?? null;
  if (documentMode === 'viewing' && capability?.canDecide !== false) {
    return { canDecide: false, reason: 'review-surface-read-only' };
  }
  return capability;
});

const getResolveDisabledReason = (comment: CommentModel) => {
  if (isV2Mode.value && comment?.trackedChange) {
    // Tracked-change accept (resolve) routes through the v2 adapter. Disable
    // the control only when the v2 host reports a real precondition.
    if (!v2TrackedChangesAdapter.value) return 'v2-tracked-change-adapter-missing';
    const cap = v2TrackedChangeCapability.value;
    if (cap && cap.canDecide === false) return cap.reason ?? 'v2-tracked-change-unavailable';
    return null;
  }
  if (isV2WriteDisabled.value) {
    return v2WriteCapability.value?.reason ?? 'v2-write-unavailable';
  }
  return null;
};
const getRejectDisabledReason = (comment: CommentModel) => {
  if (isV2Mode.value && comment?.trackedChange) {
    if (!v2TrackedChangesAdapter.value) return 'v2-tracked-change-adapter-missing';
    const cap = v2TrackedChangeCapability.value;
    if (cap && cap.canDecide === false) return cap.reason ?? 'v2-tracked-change-unavailable';
    return null;
  }
  if (isV2WriteDisabled.value) {
    return v2WriteCapability.value?.reason ?? 'v2-write-unavailable';
  }
  return null;
};

// Row 864 reopen: reopen is v2-only (no v1 reopen path). It is disabled when
// the comments module is read-only or when the v2 host reports writes are
// unavailable, surfacing the same stable reason used for resolve/edit/delete.
const getReopenDisabledReason = () => {
  if (!isV2Mode.value) return null;
  if (!v2CommentsAdapter.value) return 'v2-comments-adapter-missing';
  if (commentsAreReadOnly()) return 'read-only-document';
  if (isV2WriteDisabled.value) {
    return v2WriteCapability.value?.reason ?? 'v2-write-unavailable';
  }
  return null;
};

// TCS Phase 0 / 004 §5: when v2 reports canWrite === false (e.g.
// `author-required`, host not ready), overflow-menu Edit / Delete must hide
// or disable. We surface a stable reason through CommentHeader so the menu
// can filter both options consistently with the visible resolve/reject
// disabled treatment.
const v2OverflowWriteDisabledReason = computed(() => {
  if (!isV2Mode.value) return null;
  if (!isV2WriteDisabled.value) return null;
  return v2WriteCapability.value?.reason ?? 'v2-write-unavailable';
});

const reportTrackedChangeDecisionFailure = (decision: TrackedChangeDecision, outcome: MutationOutcome | undefined) => {
  trackedChangeDecisionFailure.value = {
    decision,
    reason: outcome?.reason ?? null,
  };
  nextTick(() => emit('resize'));
};

const clearTrackedChangeDecisionFailure = () => {
  if (!trackedChangeDecisionFailure.value) return;
  trackedChangeDecisionFailure.value = null;
  nextTick(() => emit('resize'));
};

const trackedChangeDecisionFailureMessage = computed(() => {
  const failure = trackedChangeDecisionFailure.value;
  if (!failure) return null;
  const action = failure.decision === 'reject' ? 'reject' : 'accept';
  if (failure.reason === 'stale-catalog') {
    return `Couldn't ${action} this change because the review list is stale.`;
  }
  return `Couldn't ${action} this change.`;
});

const retryTrackedChangeDecision = () => {
  const failure = trackedChangeDecisionFailure.value;
  if (!failure) return;
  trackedChangeDecisionFailure.value = null;
  if (failure.decision === 'reject') {
    handleReject();
    return;
  }
  handleResolve();
};

const handleReject = async () => {
  if (props.comment.trackedChange) {
    if (trackedChangeDecisionsAreDisabled()) return trackedChangeDecisionDisabledOutcome();
  } else if (commentsAreReadOnly()) {
    return readOnlyMutationOutcome();
  }

  const customHandler = proxy.$superdoc.config.onTrackedChangeBubbleReject;

  if (props.comment.trackedChange) {
    if (isV2Mode.value) {
      // ui-phase3-003: route tracked-change reject through the store-owned
      // v2 adapter path. Vue state and customer callbacks run only after the
      // v2 receipt commits and the store reconciles from trackChanges.list().
      // Vue state is NOT mutated until the dispatch commits and the store
      // bubble handlers receive the v2 facade explicitly after success.
      const outcome = await commentsStore.decideTrackedChangeFromSidebar({
        superdoc: proxy.$superdoc,
        comment: props.comment,
        decision: 'reject',
      });
      if (!outcome?.ok || outcome.success === false) {
        // SD-3772 §6: surface the failure (e.g. `stale-catalog`) instead of
        // silently swallowing it. The row stays; focus is not restored.
        reportTrackedChangeDecisionFailure('reject', outcome);
        return;
      }
      clearTrackedChangeDecisionFailure();
      if (typeof customHandler === 'function') {
        customHandler(props.comment, proxy.$superdoc.activeEditor);
      }
      nextTick(() => {
        commentsStore.lastUpdate = new Date();
        activeComment.value = null;
        commentsStore.setActiveComment(proxy.$superdoc, activeComment.value);
        proxy.$superdoc.focus?.({ preventScroll: true });
      });
      return;
    }

    // Custom handlers always resolve so the bubble disappears from
    // getFloatingComments (SD-2049). The internal decision path only resolves
    // when the decision actually applied; otherwise the tracked marks are
    // still in the document and the thread must stay open (SD-3386).
    let decisionApplied = true;
    if (typeof customHandler === 'function') {
      customHandler(props.comment, proxy.$superdoc.activeEditor);
    } else {
      const outcome = await commentsStore.decideTrackedChangeFromSidebar({
        superdoc: proxy.$superdoc,
        comment: props.comment,
        decision: 'reject',
      });
      decisionApplied = Boolean(outcome?.ok) && outcome.success !== false;
    }

    if (decisionApplied) {
      props.comment.resolveComment({
        id: superdocStore.user.id,
        email: superdocStore.user.email,
        name: superdocStore.user.name,
        superdoc: proxy.$superdoc,
        decision: 'reject',
        reconciliationToken: COMMENT_RECONCILIATION_TOKEN,
      });
    }
  } else if (isV2Mode.value && v2CommentsAdapter.value) {
    // ui-phase3-002: route delete through the v2 host. Vue state mutates
    // only after the receipt commits and we refresh from the v2 list.
    const outcome = await commentsStore.deleteComment({
      superdoc: proxy.$superdoc,
      commentId: props.comment.commentId,
    });
    if (!outcome?.ok) return;
  } else {
    commentsStore.deleteComment({ superdoc: proxy.$superdoc, commentId: props.comment.commentId });
  }

  // Always cleanup the dialog state
  nextTick(() => {
    commentsStore.lastUpdate = new Date();
    activeComment.value = null;
    commentsStore.setActiveComment(proxy.$superdoc, activeComment.value);
    proxy.$superdoc.focus?.();
  });
};

const handleResolve = async () => {
  if (props.comment.trackedChange) {
    if (trackedChangeDecisionsAreDisabled()) return trackedChangeDecisionDisabledOutcome();
  } else {
    if (commentsAreReadOnly()) return readOnlyMutationOutcome();
    if (resolveIsDisabled()) return resolveDisabledOutcome();
  }

  const customHandler = proxy.$superdoc.config.onTrackedChangeBubbleAccept;

  // ui-phase3-003: route tracked-change accept through the v2 adapter when
  // v2 mode is active. Vue state mutates only after the dispatch commits and
  // the store reconciles from `host.getHandles().trackChanges.list()`.
  if (props.comment.trackedChange && isV2Mode.value) {
    const outcome = await commentsStore.decideTrackedChangeFromSidebar({
      superdoc: proxy.$superdoc,
      comment: props.comment,
      decision: 'accept',
    });
    if (!outcome?.ok || outcome.success === false) {
      // SD-3772 §6: surface the failure (e.g. `stale-catalog`) instead of
      // silently swallowing it. The row stays; focus is not restored.
      reportTrackedChangeDecisionFailure('accept', outcome);
      return;
    }
    clearTrackedChangeDecisionFailure();
    if (typeof customHandler === 'function') {
      customHandler(props.comment, proxy.$superdoc.activeEditor);
    }
    nextTick(() => {
      commentsStore.lastUpdate = new Date();
      activeComment.value = null;
      commentsStore.setActiveComment(proxy.$superdoc, activeComment.value);
      proxy.$superdoc.focus?.({ preventScroll: true });
    });
    return;
  }

  let v1TrackedChangeDecisionApplied = true;
  if (props.comment.trackedChange && typeof customHandler === 'function') {
    // Custom handlers always resolve so the bubble disappears from
    // getFloatingComments (SD-2049).
    customHandler(props.comment, proxy.$superdoc.activeEditor);
  } else if (props.comment.trackedChange) {
    const outcome = await commentsStore.decideTrackedChangeFromSidebar({
      superdoc: proxy.$superdoc,
      comment: props.comment,
      decision: 'accept',
    });
    v1TrackedChangeDecisionApplied = Boolean(outcome?.ok) && outcome.success !== false;
  } else if (isV2Mode.value && v2CommentsAdapter.value) {
    // TCS Phase 0 / 004 §4.3: route resolve through the store-owned
    // `resolveCommentV2` helper. The store owns capability gating, adapter
    // identity stamping, reconciliation, the active-row clearing decision,
    // and the rejected `comments-update` event. Plan §4.3: leave the row
    // active on rejection so the user can retry.
    const outcome = await commentsStore.resolveCommentV2({
      superdoc: proxy.$superdoc,
      commentId: props.comment.commentId,
    });
    if (!outcome?.ok) {
      commentSaveFailure.value = commentSaveFailureMessage(outcome, false);
      return outcome;
    }
    commentSaveFailure.value = '';
  } else {
    props.comment.resolveComment({
      id: superdocStore.user.id,
      email: superdocStore.user.email,
      name: superdocStore.user.name,
      superdoc: proxy.$superdoc,
    });
  }

  // For v1 tracked changes we still need to resolve the local Vue model so the
  // bubble disappears from getFloatingComments after the document decision works.
  if (props.comment.trackedChange && !isV2Mode.value && v1TrackedChangeDecisionApplied) {
    props.comment.resolveComment({
      id: superdocStore.user.id,
      email: superdocStore.user.email,
      name: superdocStore.user.name,
      superdoc: proxy.$superdoc,
      decision: 'accept',
      reconciliationToken: COMMENT_RECONCILIATION_TOKEN,
    });
  }

  // Always cleanup the dialog state
  nextTick(() => {
    commentsStore.lastUpdate = new Date();
    activeComment.value = null;
    commentsStore.setActiveComment(proxy.$superdoc, activeComment.value);
    proxy.$superdoc.focus?.();
  });
};

// Row 864 reopen: reopen a resolved root comment through the store-owned
// `reopenCommentV2` helper. The store owns capability gating, adapter identity
// stamping, refresh reconciliation, and the open-state event. Vue state is not
// mutated locally before the receipt/refresh confirms the thread is open. On
// rejection the row stays resolved so the user can retry.
const handleReopen = async () => {
  if (commentsAreReadOnly()) return readOnlyMutationOutcome();
  if (resolveIsDisabled()) return resolveDisabledOutcome();
  if (!isV2Mode.value || !v2CommentsAdapter.value) return;
  const outcome = await commentsStore.reopenCommentV2({
    superdoc: proxy.$superdoc,
    commentId: props.comment.commentId,
  });
  if (!outcome?.ok) {
    commentSaveFailure.value = commentSaveFailureMessage(outcome, false);
    return outcome;
  }
  commentSaveFailure.value = '';
  nextTick(() => {
    commentsStore.lastUpdate = new Date();
    commentsStore.setActiveComment(proxy.$superdoc, activeComment.value);
    proxy.$superdoc.focus?.();
  });
};

const handleOverflowSelect = async (value: string, comment: CommentModel) => {
  if (commentsAreReadOnly()) return readOnlyMutationOutcome();

  switch (value) {
    case 'edit':
      commentEditSessions.set(commentsStore, { owner: editSessionOwner, submission: null });
      currentCommentText.value = comment?.commentText ?? '';
      currentCommentMentions.value = Array.isArray(comment?.mentions) ? [...comment.mentions] : [];
      activeComment.value = props.comment.commentId;
      if (props.floatingInstanceId) {
        setActiveFloatingCommentInstance(props.floatingInstanceId);
      }
      editingCommentId.value = comment.commentId;
      commentsStore.setActiveComment(proxy.$superdoc, activeComment.value);
      nextTick(() => {
        focusEditInput(comment.commentId);
      });
      break;
    case 'delete':
      {
        const outcome = await deleteComment({ superdoc: proxy.$superdoc, commentId: comment.commentId });
        commentSaveFailure.value = outcome?.ok ? '' : commentSaveFailureMessage(outcome, false);
      }
      break;
  }
};

const handleCommentUpdate = async (comment: CommentModel) => {
  if (commentsAreReadOnly()) return readOnlyMutationOutcome();

  // TCS Phase 0 / 004 §4.2: in v2 mode route edit through the store-owned
  // `editCommentV2` helper. The store owns capability gating, adapter
  // identity stamping, reconciliation, and emits the rejected event when the
  // dispatch / refresh fails. The dialog only owns `editingCommentId` and
  // text input; we keep both intact on rejection so the user can retry.
  if (isV2Mode.value && v2CommentsAdapter.value) {
    const session = commentEditSessions.get(commentsStore);
    const submission = Symbol('comment-edit-submission');
    if (session?.owner === editSessionOwner) session.submission = submission;
    const editorOwner = captureCommentEditorOwner();
    const documentId = editorOwner.adapter.documentId;
    const thread = props.comment;
    const draft = currentCommentText.value;
    const outcome = await commentsStore.editCommentV2({
      superdoc: proxy.$superdoc,
      commentId: comment.commentId,
      text: draft,
    });
    if (
      session?.owner !== editSessionOwner ||
      commentEditSessions.get(commentsStore) !== session ||
      session.submission !== submission ||
      !editorOwner.isCurrent() ||
      editorOwner.adapter.documentId !== documentId ||
      props.comment !== thread ||
      editingCommentId.value !== comment.commentId ||
      currentCommentText.value !== draft
    )
      return outcome;
    if (!outcome?.ok) {
      commentSaveFailure.value = commentSaveFailureMessage(outcome);
      return outcome;
    }
    commentSaveFailure.value = '';
    retireOwnEditSession();
    editingCommentId.value = null;
    removePendingComment(proxy.$superdoc);
    return outcome;
  }
  editingCommentId.value = null;
  comment.setText({ text: currentCommentText.value, superdoc: proxy.$superdoc });
  removePendingComment(proxy.$superdoc);
};

const handleInternalExternalSelect = (value: string) => {
  if (commentsAreReadOnly()) return readOnlyMutationOutcome();

  const isPendingComment = !!pendingComment.value;
  const isInternal = value.toLowerCase() === 'internal';

  if (!isPendingComment) props.comment.setIsInternal({ isInternal: isInternal, superdoc: proxy.$superdoc });
  else pendingComment.value!.isInternal = isInternal;
};

const getSidebarCommentStyle = computed(() => {
  const style: { zIndex?: number } = {};

  if (isDialogActive.value || isPendingNewComment.value || isEditingAnyComment.value) {
    style.zIndex = 50;
  }

  return style;
});

const getProcessedDate = (timestamp: string | number) => {
  const isString = typeof timestamp === 'string';
  return isString ? new Date(timestamp).getTime() : timestamp;
};

const handleCancel = () => {
  commentSaveFailure.value = '';
  retireOwnEditSession();
  retireOwnReplySession();
  editingCommentId.value = null;
  isReplying.value = false;
  cancelComment(proxy.$superdoc);
};

const usersFiltered = computed(() => {
  const users = proxy.$superdoc.users;

  if (props.comment.isInternal === true) {
    return users.filter(
      (user) => user.access === 'internal' || (typeof user.access === 'object' && user.access?.role === 'internal'),
    );
  }

  return users;
});

onMounted(() => {
  proxy.$superdoc?.on?.('active-editor-change', refreshActiveEditor);
  if (props.autoFocus) {
    nextTick(() => setFocus());
  }

  // Auto-focus the input for pending new comments
  if (isPendingNewComment.value) {
    nextTick(() => {
      commentInput.value?.focus?.({ preventScroll: true });
    });
  }

  nextTick(() => {
    const commentId =
      props.floatingInstanceId ??
      (props.comment.importedId !== undefined ? props.comment.importedId : props.comment.commentId);
    emit('ready', { commentId, elementRef: commentDialogElement });
    checkOverflow();
  });
});

onBeforeUnmount(() => {
  retireOwnEditSession();
  retireOwnReplySession();
  proxy.$superdoc?.off?.('active-editor-change', refreshActiveEditor);
});

watch(
  showInputSection,
  (isVisible) => {
    if (!isVisible) return;
    nextTick(() => {
      commentInput.value?.focus?.(isPendingNewComment.value ? { preventScroll: true } : undefined);
    });
  },
  { immediate: true },
);

watch(editingCommentId, (commentId) => {
  if (!commentId || !isDialogActive.value) return;
  const entry = comments.value.find((comment) => comment.commentId === commentId);
  if (!entry || entry.trackedChange) return;
  nextTick(() => {
    focusEditInput(commentId);
  });
});

// Config can change while a dropdown, reply composer, edit input, or pending
// comment is open. Close those transient mutation surfaces immediately; the
// store guards below the component remain the final defense against stale
// events that were already queued before this watcher ran.
watch(
  commentsAreReadOnly,
  (readOnly) => {
    if (!readOnly) return;

    isReplying.value = false;
    if (comments.value.some((comment) => comment.commentId === editingCommentId.value)) {
      editingCommentId.value = null;
    }
    if (isPendingNewComment.value) {
      cancelComment(proxy.$superdoc);
    }
    nextTick(() => emit('resize'));
  },
  { immediate: true },
);

watch(isV2WriteDisabled, (isDisabled) => {
  if (!isDisabled) return;
  isReplying.value = false;
  nextTick(() => emit('resize'));
});
</script>

<template>
  <div
    class="comments-dialog"
    :class="{ 'is-active': isDialogActive || isPendingNewComment, 'is-resolved': props.comment.resolvedTime }"
    v-click-outside="handleClickOutside"
    @click.stop="handleDialogClick"
    :style="getSidebarCommentStyle"
    ref="commentDialogElement"
    role="dialog"
    :aria-label="dialogAccessibleLabel"
    data-sd-part="comment-thread"
    data-editor-ui-surface
    :data-comment-instance-id="props.floatingInstanceId ?? ''"
    :data-comment-thread-id="props.comment.commentId ?? ''"
    :data-comment-position-key="props.comment.trackedChangeAnchorKey ?? ''"
    :data-comment-page-index="Number.isFinite(props.floatingPageIndex) ? props.floatingPageIndex : ''"
  >
    <!-- ── New comment card (pending) ── -->
    <template v-if="isPendingNewComment">
      <div v-if="shouldShowInternalExternal" class="existing-internal-input">
        <InternalDropdown
          @click.stop.prevent
          class="sd-internal-dropdown"
          :is-disabled="false"
          :state="pendingComment!.isInternal ? 'internal' : 'external'"
          @select="handleInternalExternalSelect"
        />
      </div>

      <CommentHeader :config="getConfig" :comment="props.comment" :is-pending-input="true" />

      <div class="new-comment-input-wrapper">
        <CommentInput
          ref="commentInput"
          :users="usersFiltered"
          :config="getConfig"
          :comment="props.comment"
          :include-header="false"
        />
      </div>
      <p v-if="commentSaveFailure" class="tracked-change-decision-alert" role="alert">{{ commentSaveFailure }}</p>
      <div class="reply-actions">
        <button class="sd-button reply-btn-cancel" @click.stop.prevent="handleCancel">Cancel</button>
        <button
          class="sd-button primary reply-btn-primary"
          @click.stop.prevent="handleAddComment"
          :disabled="!hasTextContent || isSubmittingNewComment"
          :class="{ 'sd-is-disabled': !hasTextContent || isSubmittingNewComment }"
        >
          Comment
        </button>
      </div>
    </template>

    <!-- ── Existing comment card ── -->
    <template v-else>
      <!-- Resolved badge -->
      <div v-if="resolvedBadgeLabel" class="resolved-badge">
        <span class="resolved-badge__icon" v-html="superdocIcons.markDone"></span>
        {{ resolvedBadgeLabel }}
      </div>

      <div v-if="shouldShowInternalExternal" class="existing-internal-input">
        <InternalDropdown
          @click.stop.prevent
          class="sd-internal-dropdown"
          :is-disabled="isInternalDropdownDisabled"
          :state="comment.isInternal ? 'internal' : 'external'"
          @select="handleInternalExternalSelect"
        />
      </div>

      <p v-if="commentSaveFailure" class="tracked-change-decision-alert" role="alert">{{ commentSaveFailure }}</p>

      <!-- Comments and their threaded (sub) comments are rendered here -->
      <div v-for="(comment, index) in visibleComments" :key="comment.commentId" class="conversation-item">
        <CommentHeader
          :config="getConfig"
          :timestamp="getProcessedDate(comment.createdTime)"
          :comment="comment"
          :is-active="isDialogActive"
          :resolve-disabled-reason="getResolveDisabledReason(comment) ?? undefined"
          :reject-disabled-reason="getRejectDisabledReason(comment) ?? undefined"
          :reopen-supported="isV2Mode && Boolean(v2CommentsAdapter)"
          :reopen-disabled-reason="getReopenDisabledReason() ?? undefined"
          :write-disabled-reason="v2OverflowWriteDisabledReason ?? undefined"
          @resolve="handleResolve"
          @reject="handleReject"
          @reopen="handleReopen"
          @overflow-select="handleOverflowSelect($event, comment)"
        />

        <div class="card-section comment-body" v-if="comment.trackedChange">
          <div
            class="tracked-change"
            :class="index === 0 ? bodyOverflowClass : undefined"
            :data-track-change-semantic-color-key="comment.semanticColorKey ?? undefined"
            :ref="index === 0 ? setParentBodyRef : undefined"
          >
            <!-- Signed semantic label (TCS-LIST-005): when present it replaces
                 every hardcoded variant copy below (no `Format: ` prefix, no
                 `Added new line`, no deletion phrasing). Optional per-member
                 detail lines render under the summary. -->
            <div v-if="comment.trackedChangeLabel">
              <span class="change-type tracked-change-label">{{ comment.trackedChangeLabel }}</span>
              <div
                v-if="comment.trackedChangeDetailLines && comment.trackedChangeDetailLines.length"
                class="tracked-change-detail-lines"
              >
                <div
                  v-for="(line, lineIndex) in comment.trackedChangeDetailLines"
                  :key="lineIndex"
                  class="tracked-change-detail-line"
                >
                  <span v-if="line.excerpt" class="tracked-change-text">"{{ line.excerpt }}"</span
                  ><span v-if="line.excerpt" class="change-type"> — </span
                  ><span class="change-type">{{ line.label }}</span>
                </div>
              </div>
            </div>
            <div v-else-if="comment.trackedChangeDisplayType === 'hyperlinkAdded'">
              <span class="change-type">Added hyperlink </span>
              <span class="tracked-change-text is-inserted">"{{ comment.trackedChangeText }}"</span>
            </div>
            <div v-else-if="comment.trackedChangeDisplayType === 'hyperlinkModified'">
              <span class="change-type">Changed hyperlink to </span>
              <span class="tracked-change-text is-inserted">"{{ comment.trackedChangeText }}"</span>
            </div>
            <div v-else-if="comment.trackedChangeDisplayType === 'paragraphSplit'">
              <span class="change-type">Added new line</span>
            </div>
            <div v-else-if="comment.trackedChangeDisplayType === 'tableInsert'">
              <span class="change-type">Added table</span>
            </div>
            <div v-else-if="comment.trackedChangeDisplayType === 'tableDelete'">
              <span class="change-type">Deleted table</span>
            </div>
            <div v-else-if="comment.trackedChangeType === 'trackFormat'">
              <span class="change-type">Format: </span>
              <span class="tracked-change-text">{{ comment.trackedChangeText }}</span>
            </div>
            <div v-else-if="comment.trackedChangeType === 'both'">
              <span class="change-type">Replaced </span>
              <span class="tracked-change-text is-deleted">"{{ comment.deletedText }}"</span>
              <span class="change-type"> with </span>
              <span class="tracked-change-text is-inserted">"{{ comment.trackedChangeText }}"</span>
            </div>
            <div v-else-if="comment.deletedText && comment.deletedText === '\n'">
              <span class="change-type">Deleted line break</span>
            </div>
            <div v-else-if="comment.trackedChangeText && comment.trackedChangeText === '\n'">
              <span class="change-type">Added line break</span>
            </div>
            <div v-else-if="comment.deletedText">
              <span class="change-type">Deleted </span>
              <span class="tracked-change-text is-deleted">"{{ comment.deletedText }}"</span>
            </div>
            <div v-else-if="comment.trackedChangeText">
              <span class="change-type">Added </span>
              <span class="tracked-change-text is-inserted">"{{ comment.trackedChangeText }}"</span>
            </div>
            <div
              v-if="comment.trackedChangeImagePreview?.src"
              class="tracked-change-image-preview"
              :data-track-change-image-preview-role="comment.trackedChangeImagePreview.role ?? undefined"
            >
              <img
                class="tracked-change-image-preview__image"
                :src="comment.trackedChangeImagePreview.src"
                :alt="comment.trackedChangeImagePreview.alt || 'Tracked image preview'"
                :style="trackedChangeImagePreviewStyle(comment.trackedChangeImagePreview)"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
          <div
            v-if="shouldTruncate && isTextOverflowing && index === 0"
            class="show-more-toggle"
            @click.stop.prevent="toggleTruncation"
          >
            Show more
          </div>
          <div
            v-if="textExpanded && isTextOverflowing && index === 0"
            class="show-more-toggle"
            @click.stop.prevent="toggleTruncation"
          >
            Show less
          </div>
        </div>

        <!-- Show the comment text, unless we enter edit mode, then show an input and update buttons -->
        <div class="card-section comment-body" v-if="!comment.trackedChange">
          <div
            v-if="!isEditingThisComment(comment)"
            class="comment"
            :class="index === 0 ? bodyOverflowClass : undefined"
            :ref="index === 0 ? setParentBodyRef : undefined"
            v-html="renderedCommentTexts.get(comment.commentId)"
          ></div>
          <div v-else class="reply-expanded">
            <div class="reply-input-wrapper">
              <CommentInput
                :ref="setEditCommentInputRef(comment.commentId)"
                :users="[]"
                :config="getConfig"
                :include-header="false"
                :comment="comment"
              />
            </div>
            <div class="reply-actions">
              <button class="sd-button reply-btn-cancel" @click.stop.prevent="handleCancel">Cancel</button>
              <button
                class="sd-button primary reply-btn-primary"
                @click.stop.prevent="handleCommentUpdate(comment)"
                :disabled="!hasTextContent || isV2WriteDisabled"
                :class="{ 'sd-is-disabled': !hasTextContent || isV2WriteDisabled }"
                :data-disabled-reason="isV2WriteDisabled ? (v2WriteCapability?.reason ?? null) : null"
              >
                Update
              </button>
            </div>
          </div>
          <div
            v-if="shouldTruncate && isTextOverflowing && index === 0 && !isEditingThisComment(comment)"
            class="show-more-toggle"
            @click.stop.prevent="toggleTruncation"
          >
            Show more
          </div>
          <div
            v-if="textExpanded && isTextOverflowing && index === 0 && !isEditingThisComment(comment)"
            class="show-more-toggle"
            @click.stop.prevent="toggleTruncation"
          >
            Show less
          </div>
        </div>

        <!-- Thread collapse: after parent (index 0), show "N more replies" -->
        <template v-if="shouldCollapseThread && index === 0">
          <div class="comment-separator"></div>
          <div class="collapsed-replies" @click.stop.prevent="expandThread">
            <div class="collapsed-avatars">
              <Avatar
                v-for="author in collapsedReplyAuthors"
                :key="(author.email || author.name) ?? undefined"
                :user="author"
                class="mini-avatar"
              />
            </div>
            <span>{{ collapsedReplyCount }} more {{ collapsedReplyCount === 1 ? 'reply' : 'replies' }}</span>
          </div>
        </template>

        <div class="comment-separator" v-if="showSeparator(index)"></div>
      </div>

      <!-- Visible failure state for a rejected tracked-change decision (SD-3772 §6) -->
      <div v-if="trackedChangeDecisionFailure" class="tracked-change-decision-alert" role="alert">
        <span class="tracked-change-decision-alert__message">{{ trackedChangeDecisionFailureMessage }}</span>
        <button
          type="button"
          class="sd-button tracked-change-decision-alert__retry"
          @click.stop.prevent="retryTrackedChangeDecision"
        >
          Retry
        </button>
      </div>

      <!-- Reply area: pill that expands in-place with action buttons -->
      <template v-if="showInputSection">
        <button
          v-if="!isReplying"
          type="button"
          class="reply-pill"
          @click.stop.prevent="startReply"
          :disabled="isV2WriteDisabled"
          :class="{ 'sd-is-disabled': isV2WriteDisabled }"
          :data-disabled-reason="isV2WriteDisabled ? (v2WriteCapability?.reason ?? null) : null"
        >
          Reply or add others with @
        </button>
        <div v-else class="reply-expanded">
          <div class="reply-input-wrapper">
            <CommentInput
              ref="commentInput"
              :users="usersFiltered"
              :config="getConfig"
              :comment="props.comment"
              :include-header="false"
            />
          </div>
          <div class="reply-actions">
            <button class="sd-button reply-btn-cancel" @click.stop.prevent="handleCancel">Cancel</button>
            <button
              class="sd-button primary reply-btn-primary"
              @click.stop.prevent="handleAddComment"
              :disabled="!hasTextContent || isV2WriteDisabled || isSubmittingReply"
              :class="{ 'sd-is-disabled': !hasTextContent || isV2WriteDisabled || isSubmittingReply }"
              :data-disabled-reason="v2ReplyDisabledReason"
            >
              Reply
            </button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.comments-dialog {
  display: flex;
  flex-direction: column;
  padding: var(--sd-ui-comments-card-padding, 16px);
  border-radius: var(--sd-ui-comments-card-radius, 12px);
  background-color: var(--sd-ui-comments-card-bg, #f3f6fd);
  border: 1px solid transparent;
  font-family: var(--sd-ui-font-family, Arial, Helvetica, sans-serif);
  font-size: var(--sd-ui-comments-body-size, 14px);
  line-height: 1.5;
  transition: var(--sd-ui-comments-transition, all 200ms ease);
  box-shadow: none;
  z-index: 5;
  max-width: 300px;
  min-width: 200px;
  width: 100%;
  overflow-wrap: break-word;
  word-break: break-word;
}
.comments-dialog:not(.is-active) {
  cursor: pointer;
}
.comments-dialog:not(.is-active):not(.is-resolved):hover {
  background-color: var(--sd-ui-comments-card-hover-bg, #f3f6fd);
}
.comments-dialog:not(.is-resolved):hover :deep(.overflow-menu) {
  opacity: 1;
  pointer-events: auto;
}
.comments-dialog.is-active {
  background-color: var(--sd-ui-comments-card-active-bg, #ffffff);
  border-color: var(--sd-ui-comments-card-active-border, #e0e0e0);
  box-shadow: var(--sd-ui-comments-card-shadow, 0px 4px 12px 0px rgba(50, 50, 50, 0.15));
  z-index: 10;
}
.comments-dialog.is-resolved {
  background-color: var(--sd-ui-comments-card-resolved-bg, #f0f0f0);
}

.comment-separator {
  background-color: var(--sd-ui-comments-separator, #e0e0e0);
  height: 1px;
  width: 100%;
  margin: 10px 0;
}

.comment {
  font-size: var(--sd-ui-comments-body-size, 14px);
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--sd-ui-comments-body-text, #212121);
  margin: 4px 0 0 0;
}
.comment :deep(p) {
  margin: 0;
}
.comment :deep(a) {
  color: var(--sd-ui-action, #1354ff);
  text-decoration: underline;
}

.tracked-change {
  font-size: var(--sd-ui-comments-body-size, 14px);
  line-height: 1.5;
  color: var(--sd-ui-comments-body-text, #212121);
  margin: 4px 0 0 0;
}
.change-type {
  color: var(--sd-ui-comments-body-text, #212121);
}
.tracked-change-text {
  color: var(--sd-ui-comments-body-text, #212121);
  white-space: pre-wrap;
}
.tracked-change-text.is-deleted {
  color: var(--sd-ui-comments-delete-text, #cb0e47);
}
.tracked-change-text.is-inserted {
  color: var(--sd-ui-comments-insert-text, #1f6feb);
  font-weight: 500;
}
.tracked-change[data-track-change-semantic-color-key='move-from'] .tracked-change-text.is-deleted {
  color: var(--sd-ui-comments-move-from-text, #00853d);
}
.tracked-change[data-track-change-semantic-color-key='move-to'] .tracked-change-text.is-inserted {
  color: var(--sd-ui-comments-move-to-text, #00853d);
}
.tracked-change-detail-lines {
  margin-top: 4px;
}
.tracked-change-detail-line {
  font-size: 12px;
  line-height: 1.4;
}
.tracked-change-image-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 6px;
  padding: 2px;
  border: 1px solid var(--sd-ui-comments-border, #dadce0);
  background: var(--sd-ui-comments-bg, #fff);
  max-width: 96px;
  max-height: 96px;
}
.tracked-change-image-preview__image {
  display: block;
  width: auto;
  height: auto;
  max-width: 90px;
  max-height: 90px;
  object-fit: contain;
}

/* ── Failed tracked-change decision alert (SD-3772 §6) ── */
.tracked-change-decision-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--sd-ui-comments-alert-border, #f0b4b4);
  background-color: var(--sd-ui-comments-alert-bg, #fdf3f3);
  color: var(--sd-ui-comments-alert-text, #a4262c);
  font-size: var(--sd-ui-comments-body-size, 14px);
  line-height: 1.4;
}
.tracked-change-decision-alert__retry {
  flex-shrink: 0;
}

/* ── Resolved badge ── */
.resolved-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--sd-ui-comments-resolved-text, #00853d);
  margin-bottom: 4px;
}
.resolved-badge__icon {
  display: inline-flex;
  width: 12px;
  height: 12px;
}
.resolved-badge__icon :deep(svg) {
  width: 100%;
  height: 100%;
  fill: currentColor;
}

/* ── Text truncation ── */
.comment.is-truncated,
.tracked-change.is-truncated {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  max-height: 4.5em;
  overflow: hidden;
}
.comment.is-scrollable,
.tracked-change.is-scrollable {
  max-height: 220px;
  overflow-y: auto;
  padding-right: 4px;
}
.show-more-toggle {
  font-size: 12px;
  color: var(--sd-ui-action, #1355ff);
  cursor: pointer;
  font-weight: 500;
  margin-top: 4px;
  user-select: none;
}
.show-more-toggle:hover {
  text-decoration: underline;
}

/* ── Thread collapse ── */
.collapsed-replies {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  font-size: 12px;
  color: var(--sd-ui-action, #1355ff);
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}
.collapsed-replies:hover {
  text-decoration: underline;
}
.collapsed-avatars {
  display: flex;
}
.collapsed-avatars .mini-avatar {
  --sd-comment-avatar-size: 20px;
  --sd-comment-avatar-font-size: 8px;
  margin-left: -4px;
  border: 2px solid var(--sd-ui-comments-card-active-bg, #ffffff);
}
.collapsed-avatars .mini-avatar:first-child {
  margin-left: 0;
}

/* ── New comment input ── */
.new-comment-input-wrapper {
  border: 1.5px solid var(--sd-ui-comments-input-border, #dbdbdb);
  border-radius: 12px;
  padding: 8.5px 10.5px;
  background: var(--sd-ui-comments-input-bg, #ffffff);
  margin-top: 4px;
  max-height: 150px;
  overflow: visible;
}
.new-comment-input-wrapper:focus-within {
  border-color: var(--sd-ui-comments-input-focus-border, #4f7cff);
  box-shadow: 0 0 0 2px rgba(79, 124, 255, 0.16);
}
.new-comment-input-wrapper :deep(.comment-entry) {
  border-radius: 0;
}
.new-comment-input-wrapper :deep(.input-section) {
  margin: 0;
}
.new-comment-input-wrapper :deep(.superdoc-field) {
  font-size: 14px;
  line-height: 20px;
  border: none;
  padding: 4px 0;
  border-radius: 0;
  min-height: 28px;
  height: 28px;
  max-height: 132px;
  resize: none;
}
.new-comment-input-wrapper :deep(.superdoc-field:focus),
.new-comment-input-wrapper :deep(.superdoc-field:active) {
  border: none;
  box-shadow: none;
  outline: none;
}
.new-comment-input-wrapper :deep(.sd-editor-placeholder::before) {
  content: 'Comment or add others with @';
}

/* ── Reply pill & expanded input ── */
.reply-pill {
  width: 100%;
  padding: 8.5px 10.5px;
  border: 1.5px solid transparent;
  border-radius: 9999px;
  font-family: inherit;
  font-size: 14px;
  text-align: left;
  color: var(--sd-color-gray-500, #ababab);
  background: var(--sd-color-gray-100, #f5f5f5);
  margin-top: 10px;
  cursor: text;
  transition: background 150ms ease;
}
.reply-pill:hover {
  background: var(--sd-color-gray-200, #f2f2f2);
}
.reply-pill:disabled {
  cursor: not-allowed;
}
.reply-expanded {
  margin-top: 10px;
}
.reply-input-wrapper {
  border: 1.5px solid var(--sd-ui-comments-input-border, #dbdbdb);
  border-radius: 12px;
  padding: 8.5px 10.5px;
  background: var(--sd-ui-comments-input-bg, #ffffff);
  max-height: 150px;
  overflow: visible;
}
.reply-input-wrapper:focus-within {
  border-color: var(--sd-ui-comments-input-focus-border, #4f7cff);
  box-shadow: 0 0 0 2px rgba(79, 124, 255, 0.16);
}
.reply-input-wrapper :deep(.comment-entry) {
  border-radius: 0;
}
.reply-input-wrapper :deep(.input-section) {
  margin: 0;
}
.reply-input-wrapper :deep(.superdoc-field) {
  font-size: 14px;
  line-height: 20px;
  border: none;
  padding: 4px 0;
  border-radius: 0;
  min-height: 28px;
  height: 28px;
  max-height: 132px;
  resize: none;
}
.reply-input-wrapper :deep(.superdoc-field:focus),
.reply-input-wrapper :deep(.superdoc-field:active) {
  border: none;
  box-shadow: none;
  outline: none;
}
.reply-input-wrapper :deep(.sd-editor-placeholder::before) {
  content: 'Reply or add others with @';
}
.reply-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
}
.reply-btn-cancel {
  background: none;
  border: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--sd-ui-text-muted, #666666);
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  transition: color 150ms;
}
.reply-btn-cancel:hover {
  color: var(--sd-ui-text, #212121);
}
.reply-btn-primary {
  background: var(--sd-ui-action, #1355ff);
  border: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--sd-ui-action-text, #ffffff);
  cursor: pointer;
  padding: 6px 16px;
  border-radius: 9999px;
  font-family: inherit;
  transition: background 150ms;
}
.reply-btn-primary:hover {
  background: var(--sd-ui-action-hover, #0f44cc);
}
.reply-btn-primary.sd-is-disabled {
  background: var(--sd-color-gray-400, #dbdbdb);
  color: var(--sd-color-gray-600, #888888);
  cursor: default;
  pointer-events: none;
}

.existing-internal-input {
  margin-bottom: 10px;
}

.sd-internal-dropdown {
  display: inline-block;
}
</style>
