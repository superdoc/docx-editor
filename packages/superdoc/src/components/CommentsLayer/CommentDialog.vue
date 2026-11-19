<script setup>
import { computed, ref, unref, getCurrentInstance, onMounted, nextTick, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useCommentsStore } from '@superdoc/stores/comments-store';
import { useSuperdocStore } from '@superdoc/stores/superdoc-store';
import { PresentationEditor } from '@superdoc/super-editor';
import { superdocIcons } from '@superdoc/icons.js';
import {
  getPreferredCommentFocusTargetClientY,
  getVisibleThreadAnchorClientY,
  getVisibleThreadHighlightClientY,
  scrollThreadAnchorToFocusTarget,
} from '@superdoc/helpers/comment-focus.js';
import InternalDropdown from './InternalDropdown.vue';
import CommentHeader from './CommentHeader.vue';
import CommentInput from './CommentInput.vue';
import { collectTrackedChangeThread } from './collect-tracked-change-thread.js';
import { sanitizeCommentHtml } from './comment-html.js';
import Avatar from '@superdoc/components/general/Avatar.vue';

const emit = defineEmits(['click-outside', 'ready', 'dialog-exit', 'resize']);
const props = defineProps({
  comment: {
    type: Object,
    required: true,
  },
  autoFocus: {
    type: Boolean,
    default: false,
  },
  parent: {
    type: Object,
    required: false,
  },
  floatingInstanceId: {
    type: String,
    default: null,
  },
  floatingPageIndex: {
    type: Number,
    default: null,
  },
  floatingPositionEntry: {
    type: Object,
    default: null,
  },
  isFloatingInstanceActive: {
    type: Boolean,
    default: undefined,
  },
});

const { proxy } = getCurrentInstance();
const superdocStore = useSuperdocStore();
const commentsStore = useCommentsStore();

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
  isDebugging,
  editingCommentId,
  editorCommentPositions,
  isCommentHighlighted,
} = storeToRefs(commentsStore);

const isInternal = ref(true);
const commentInput = ref(null);
const editCommentInputs = ref(new Map());
const CLICK_OUTSIDE_HIT_TOLERANCE_PX = 3;
const CLICK_OUTSIDE_HIT_SAMPLE_OFFSETS = [
  [0, 0],
  [-CLICK_OUTSIDE_HIT_TOLERANCE_PX, 0],
  [CLICK_OUTSIDE_HIT_TOLERANCE_PX, 0],
  [0, -CLICK_OUTSIDE_HIT_TOLERANCE_PX],
  [0, CLICK_OUTSIDE_HIT_TOLERANCE_PX],
];
const CLICK_OUTSIDE_IGNORED_SELECTORS = [
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

const setEditCommentInputRef = (commentId) => (el) => {
  if (!commentId) return;
  if (el) {
    editCommentInputs.value.set(commentId, el);
    if (editingCommentId.value === commentId) {
      nextTick(() => {
        focusEditInput(commentId);
      });
    }
  } else {
    editCommentInputs.value.delete(commentId);
  }
};

const elementContainsClickPoint = (element, clientX, clientY) => {
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

const findIgnoredElementByGeometry = (clientX, clientY) => {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  const ignoredElements = document.querySelectorAll(CLICK_OUTSIDE_IGNORED_SELECTORS);
  for (const element of ignoredElements) {
    if (element instanceof HTMLElement && elementContainsClickPoint(element, clientX, clientY)) {
      return element;
    }
  }

  return null;
};

const focusEditInput = (commentId) => {
  const input = editCommentInputs.value.get(commentId);
  input?.focus?.();
};
const commentDialogElement = ref(null);

const getCommentFocusThreadId = (comment) => {
  if (comment.resolvedTime) {
    return comment.commentId;
  }

  return comment.importedId || comment.commentId;
};

const getEntryBoundsCoordinate = (entry, coordinate) => {
  const value = entry?.bounds?.[coordinate];
  return Number.isFinite(value) ? value : null;
};

const entriesShareLine = (entry, candidateEntry) => {
  if (!entry || !candidateEntry) return false;
  if (entry.pageIndex !== candidateEntry.pageIndex) return false;

  const entryTop = getEntryBoundsCoordinate(entry, 'top');
  const candidateTop = getEntryBoundsCoordinate(candidateEntry, 'top');

  return entryTop != null && candidateTop != null && Math.abs(entryTop - candidateTop) < 0.5;
};

const entriesOverlapHorizontalSpan = (entry, candidateEntry) => {
  const entryLeft = getEntryBoundsCoordinate(entry, 'left');
  const candidateLeft = getEntryBoundsCoordinate(candidateEntry, 'left');
  const entryRight = getEntryBoundsCoordinate(entry, 'right');
  const candidateRight = getEntryBoundsCoordinate(candidateEntry, 'right');

  if ([entryLeft, candidateLeft, entryRight, candidateRight].some((value) => value == null)) {
    return false;
  }

  return candidateLeft < entryRight && entryLeft < candidateRight;
};

const entriesOverlapRange = (entry, candidateEntry) => {
  const entryStart = entry?.start;
  const entryEnd = entry?.end;
  const candidateStart = candidateEntry?.start;
  const candidateEnd = candidateEntry?.end;

  if (![entryStart, entryEnd, candidateStart, candidateEnd].every(Number.isFinite)) {
    return false;
  }

  return candidateStart <= entryEnd && entryStart <= candidateEnd;
};

const shouldIncludeThreadAlias = (entry, candidateEntry) => {
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
const getThreadHighlightLookupIds = (commentOrId) => {
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

const isDialogAlreadyAlignedWithTarget = (dialogElement, targetClientY, tolerancePx = 24) => {
  if (!Number.isFinite(targetClientY) || typeof dialogElement?.getBoundingClientRect !== 'function') {
    return false;
  }

  const dialogTop = dialogElement.getBoundingClientRect().top;
  return Number.isFinite(dialogTop) && Math.abs(dialogTop - targetClientY) <= tolerancePx;
};

const currentFloatingInstanceId = computed(() => {
  return props.floatingInstanceId ?? props.comment.commentId ?? null;
});

const activeCommentBelongsToDialog = computed(() => {
  const activeId = activeComment.value;
  if (activeId == null) return false;
  if (activeId === props.comment.commentId) return true;
  if (!props.comment.trackedChange) return false;

  return collectTrackedChangeThread(props.comment, commentsStore.commentsList).some(
    (comment) => comment.commentId === activeId || comment.importedId === activeId,
  );
});

const isDialogActive = computed(() => {
  if (typeof props.isFloatingInstanceActive === 'boolean') {
    return props.isFloatingInstanceActive;
  }

  if (!activeCommentBelongsToDialog.value) {
    return false;
  }

  if (props.floatingInstanceId == null) {
    return true;
  }

  if (props.comment.trackedChange && activeFloatingCommentInstanceId.value == null) {
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

const showSeparator = computed(() => (index) => {
  const visible = visibleComments.value;
  if (showInputSection.value && index === visible.length - 1) return true;
  return visible.length > 1 && index !== visible.length - 1;
});

const showInputSection = computed(() => {
  return !getConfig.readOnly && isDialogActive.value && !props.comment.resolvedTime && !isEditingAnyComment.value;
});

// Reply pill → expanded editor toggle
const isReplying = ref(false);
const startReply = () => {
  isReplying.value = true;
  nextTick(() => {
    commentInput.value?.focus?.();
    emit('resize');
  });
};

const comments = computed(() => {
  const parentComment = props.comment;
  const allComments = commentsStore.commentsList;
  const threadComments = parentComment.trackedChange
    ? collectTrackedChangeThread(parentComment, allComments)
    : allComments.filter((comment) => {
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

const sanitizedCommentTexts = computed(
  () => new Map(comments.value.map((comment) => [comment.commentId, sanitizeCommentHtml(unref(comment.commentText))])),
);

/* ── Step 2: Text truncation ── */
const textExpanded = ref(false);
const parentBodyRef = ref(null);
const isTextOverflowing = ref(false);
const shouldTruncate = computed(() => !textExpanded.value);
const toggleTruncation = () => {
  textExpanded.value = !textExpanded.value;
  nextTick(() => emit('resize'));
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
const resetInactiveThreadState = () => {
  textExpanded.value = false;
  threadExpanded.value = false;
  isReplying.value = false;
  nextTick(() => emit('resize'));
};

// Reset truncation, thread collapse, and reply state when card becomes inactive.
watch(isDialogActive, (active) => {
  if (!active) resetInactiveThreadState();
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
  if (props.comment.trackedChange) return false;
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

const collapsedReplyCount = computed(() => {
  if (!shouldCollapseThread.value) return 0;
  return childComments.value.length - 1; // only last is shown
});

const collapsedReplyAuthors = computed(() => {
  if (!shouldCollapseThread.value) return [];
  // Hidden = all replies except last
  const hidden = childComments.value.slice(0, -1);
  const seen = new Set();
  return hidden
    .map((c) =>
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

watch(activeComment, (commentId) => {
  if (commentId === props.comment.commentId) return;
  resetInactiveThreadState();
});

const isInternalDropdownDisabled = computed(() => {
  if (props.comment.resolvedTime) return true;
  return getConfig.value.readOnly;
});

const isEditingThisComment = computed(() => (comment) => {
  return isDialogActive.value && editingCommentId.value === comment.commentId;
});

const isEditingAnyComment = computed(() => {
  if (!editingCommentId.value || !isDialogActive.value) return false;
  return comments.value.some((c) => c.commentId === editingCommentId.value);
});

const shouldShowInternalExternal = computed(() => {
  if (!proxy.$superdoc.config.isInternal) return false;
  return !suppressInternalExternal.value && !props.comment.trackedChange;
});

const hasTextContent = computed(() => {
  return currentCommentText.value && currentCommentText.value !== '<p></p>';
});

const setFocus = async () => {
  const editor = proxy.$superdoc.activeEditor;
  const isTrackedChange = Boolean(props.comment?.trackedChange);
  const targetClientY = getPreferredCommentFocusTargetClientY();
  const isInstanceScopedDialog = props.floatingInstanceId != null;
  const willChangeActiveDialog =
    !props.comment.resolvedTime &&
    (activeComment.value !== props.comment.commentId ||
      (isInstanceScopedDialog && currentFloatingInstanceId.value !== activeFloatingCommentInstanceId.value));
  let instantAlignmentTargetY = targetClientY;

  // Move cursor to the comment location and set active comment in a single PM
  // transaction. This prevents a race where position-based comment detection in the
  // plugin clears the activeThreadId before the setActiveComment meta is processed.
  if (editor) {
    const { entry: resolvedFocusEntry } = resolveCommentPositionEntry(props.comment);
    const focusEntry = props.floatingPositionEntry ?? resolvedFocusEntry;
    const usePageScopedAnchorOnly =
      Number.isFinite(props.floatingPageIndex) && props.comment?.trackedChangeStory?.storyType === 'headerFooterPart';
    const visibleAnchorTargetY = getVisibleThreadAnchorClientY(props.parent, focusEntry);
    const visibleHighlightTargetY = usePageScopedAnchorOnly
      ? null
      : getVisibleThreadHighlightClientY(getThreadHighlightLookupIds(props.comment));
    const visibleThreadTargetY = Number.isFinite(visibleHighlightTargetY)
      ? visibleHighlightTargetY
      : visibleAnchorTargetY;
    const shouldSkipFocusScroll = isDialogAlreadyAlignedWithTarget(commentDialogElement.value, visibleThreadTargetY);
    const cursorId = getCommentFocusThreadId(props.comment);
    const documentId = getCommentDocumentId(props.comment);
    const presentation = documentId ? PresentationEditor.getInstance(documentId) : null;
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

      if (presentation?.navigateTo) {
        const didNavigate = await presentation.navigateTo(trackedTarget);
        if (didNavigate && !props.comment.resolvedTime) {
          commentsStore.setActiveComment(proxy.$superdoc, props.comment.commentId);
        }
      } else if (props.comment.resolvedTime) {
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
  if (willChangeActiveDialog) {
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

const handleClickOutside = (e) => {
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

const handleAddComment = async () => {
  const options = {
    documentId: props.comment.fileId,
    isInternal: pendingComment.value ? pendingComment.value.isInternal : isInternal.value,
    parentCommentId: pendingComment.value ? null : props.comment.commentId,
  };

  if (pendingComment.value) {
    const selection = pendingComment.value.selection.getValues();
    options.selection = selection;
  }

  const comment = commentsStore.getPendingComment(options);
  if (!pendingComment.value && currentCommentText.value) {
    comment.setText({ text: currentCommentText.value, suppressUpdate: true });
  }
  Promise.resolve(addComment({ superdoc: proxy.$superdoc, comment })).finally(() => {
    isReplying.value = false;
    nextTick(() => emit('resize'));
  });
};

const getResolveDisabledReason = () => null;
const getRejectDisabledReason = () => null;

const handleReject = async () => {
  const customHandler = proxy.$superdoc.config.onTrackedChangeBubbleReject;

  if (props.comment.trackedChange) {
    // Custom handlers always resolve so the bubble disappears from
    // getFloatingComments (SD-2049). The internal decision path only resolves
    // when the decision actually applied; otherwise the tracked marks are
    // still in the document and the thread must stay open (SD-3386).
    let decisionApplied = true;
    if (typeof customHandler === 'function') {
      customHandler(props.comment, proxy.$superdoc.activeEditor);
    } else {
      const outcome = commentsStore.decideTrackedChangeFromSidebar({
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
      });
    }
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
  const customHandler = proxy.$superdoc.config.onTrackedChangeBubbleAccept;

  let v1TrackedChangeDecisionApplied = true;
  if (props.comment.trackedChange && typeof customHandler === 'function') {
    // Custom handlers always resolve so the bubble disappears from
    // getFloatingComments (SD-2049).
    customHandler(props.comment, proxy.$superdoc.activeEditor);
  } else if (props.comment.trackedChange) {
    const outcome = commentsStore.decideTrackedChangeFromSidebar({
      superdoc: proxy.$superdoc,
      comment: props.comment,
      decision: 'accept',
    });
    v1TrackedChangeDecisionApplied = Boolean(outcome?.ok) && outcome.success !== false;
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
  if (props.comment.trackedChange && v1TrackedChangeDecisionApplied) {
    props.comment.resolveComment({
      id: superdocStore.user.id,
      email: superdocStore.user.email,
      name: superdocStore.user.name,
      superdoc: proxy.$superdoc,
      decision: 'accept',
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

const handleOverflowSelect = (value, comment) => {
  switch (value) {
    case 'edit':
      currentCommentText.value = sanitizeCommentHtml(comment?.commentText?.value ?? comment?.commentText ?? '');
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
      deleteComment({ superdoc: proxy.$superdoc, commentId: comment.commentId });
      break;
  }
};

const handleCommentUpdate = async (comment) => {
  editingCommentId.value = null;
  comment.setText({ text: currentCommentText.value, superdoc: proxy.$superdoc });
  removePendingComment(proxy.$superdoc);
};

const handleInternalExternalSelect = (value) => {
  const isPendingComment = !!pendingComment.value;
  const isInternal = value.toLowerCase() === 'internal';

  if (!isPendingComment) props.comment.setIsInternal({ isInternal: isInternal, superdoc: proxy.$superdoc });
  else pendingComment.value.isInternal = isInternal;
};

const getSidebarCommentStyle = computed(() => {
  const style = {};

  if (isDialogActive.value || isPendingNewComment.value || isEditingAnyComment.value) {
    style.zIndex = 50;
  }

  return style;
});

const getProcessedDate = (timestamp) => {
  const isString = typeof timestamp === 'string';
  return isString ? new Date(timestamp).getTime() : timestamp;
};

const handleCancel = (comment) => {
  editingCommentId.value = null;
  isReplying.value = false;
  cancelComment(proxy.$superdoc);
};

const usersFiltered = computed(() => {
  const users = proxy.$superdoc.users;

  if (props.comment.isInternal === true) {
    return users.filter((user) => user.access?.role === 'internal');
  }

  return users;
});

onMounted(() => {
  if (props.autoFocus) {
    nextTick(() => setFocus());
  }

  // Auto-focus the input for pending new comments
  if (isPendingNewComment.value) {
    nextTick(() => {
      commentInput.value?.focus?.();
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

watch(
  showInputSection,
  (isVisible) => {
    if (!isVisible) return;
    nextTick(() => {
      commentInput.value?.focus?.();
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
</script>

<template>
  <div
    class="comments-dialog"
    :class="{ 'is-active': isDialogActive || isPendingNewComment, 'is-resolved': props.comment.resolvedTime }"
    v-click-outside="handleClickOutside"
    @click.stop.prevent="setFocus"
    :style="getSidebarCommentStyle"
    ref="commentDialogElement"
    role="dialog"
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
          :state="pendingComment.isInternal ? 'internal' : 'external'"
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
      <div class="reply-actions">
        <button class="sd-button reply-btn-cancel" @click.stop.prevent="handleCancel">Cancel</button>
        <button
          class="sd-button primary reply-btn-primary"
          @click.stop.prevent="handleAddComment"
          :disabled="!hasTextContent"
          :class="{ 'sd-is-disabled': !hasTextContent }"
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

      <!-- Comments and their threaded (sub) comments are rendered here -->
      <div v-for="(comment, index) in visibleComments" :key="comment.commentId" class="conversation-item">
        <CommentHeader
          :config="getConfig"
          :timestamp="getProcessedDate(comment.createdTime)"
          :comment="comment"
          :is-active="isDialogActive"
          :resolve-disabled-reason="getResolveDisabledReason(comment)"
          :reject-disabled-reason="getRejectDisabledReason(comment)"
          @resolve="handleResolve"
          @reject="handleReject"
          @overflow-select="handleOverflowSelect($event, comment)"
        />

        <div class="card-section comment-body" v-if="comment.trackedChange">
          <div
            class="tracked-change"
            :class="{ 'is-truncated': shouldTruncate && index === 0 }"
            :ref="index === 0 ? (el) => (parentBodyRef = el) : undefined"
          >
            <div v-if="comment.trackedChangeDisplayType === 'hyperlinkAdded'">
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
            <div v-else-if="comment.deletedText">
              <span class="change-type">Deleted </span>
              <span class="tracked-change-text is-deleted">"{{ comment.deletedText }}"</span>
            </div>
            <div v-else-if="comment.trackedChangeText">
              <span class="change-type">Added </span>
              <span class="tracked-change-text is-inserted">"{{ comment.trackedChangeText }}"</span>
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
            v-if="!isDebugging && !isEditingThisComment(comment)"
            class="comment"
            :class="{ 'is-truncated': shouldTruncate && index === 0 }"
            :ref="index === 0 ? (el) => (parentBodyRef = el) : undefined"
            v-html="sanitizedCommentTexts.get(comment.commentId)"
          ></div>
          <div v-else-if="isDebugging && !isEditingThisComment(comment)" class="comment">
            {{
              editorCommentPositions[comment.importedId !== undefined ? comment.importedId : comment.commentId]?.bounds
            }}
          </div>
          <div v-else class="reply-expanded">
            <div class="reply-input-wrapper">
              <CommentInput
                :ref="setEditCommentInputRef(comment.commentId)"
                :users="usersFiltered"
                :config="getConfig"
                :include-header="false"
                :comment="comment"
              />
            </div>
            <div class="reply-actions">
              <button class="sd-button reply-btn-cancel" @click.stop.prevent="handleCancel(comment)">Cancel</button>
              <button
                class="sd-button primary reply-btn-primary"
                @click.stop.prevent="handleCommentUpdate(comment)"
                :disabled="!hasTextContent"
                :class="{ 'sd-is-disabled': !hasTextContent }"
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
                :key="author.email || author.name"
                :user="author"
                class="mini-avatar"
              />
            </div>
            <span>{{ collapsedReplyCount }} more {{ collapsedReplyCount === 1 ? 'reply' : 'replies' }}</span>
          </div>
        </template>

        <div class="comment-separator" v-if="showSeparator(index)"></div>
      </div>

      <!-- Reply area: pill that expands in-place with action buttons -->
      <template v-if="showInputSection && !getConfig.readOnly">
        <div v-if="!isReplying" class="reply-pill" @click.stop.prevent="startReply">Reply or add others with @</div>
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
              :disabled="!hasTextContent"
              :class="{ 'sd-is-disabled': !hasTextContent }"
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
  color: var(--sd-ui-comments-body-text, #212121);
  margin: 4px 0 0 0;
}
.comment :deep(p) {
  margin: 0;
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
}
.tracked-change-text.is-deleted {
  color: var(--sd-ui-comments-delete-text, #cb0e47);
}
.tracked-change-text.is-inserted {
  color: var(--sd-ui-comments-insert-text, #00853d);
  font-weight: 500;
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
  overflow: hidden;
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
  overflow-y: auto;
}
.new-comment-input-wrapper :deep(.comment-entry) {
  border-radius: 0;
}
.new-comment-input-wrapper :deep(.input-section) {
  margin: 0;
}
.new-comment-input-wrapper :deep(.superdoc-field) {
  font-size: 14px;
  border: none;
  padding: 0;
  border-radius: 0;
}
.new-comment-input-wrapper :deep(.superdoc-field:focus),
.new-comment-input-wrapper :deep(.superdoc-field:active) {
  border: none;
}
.new-comment-input-wrapper :deep(.sd-editor-placeholder::before) {
  content: 'Comment or add others with @';
}

/* ── Reply pill & expanded input ── */
.reply-pill {
  padding: 8.5px 10.5px;
  border: 1.5px solid transparent;
  border-radius: 9999px;
  font-size: 14px;
  color: var(--sd-color-gray-500, #ababab);
  background: var(--sd-color-gray-100, #f5f5f5);
  margin-top: 10px;
  cursor: text;
  transition: background 150ms ease;
}
.reply-pill:hover {
  background: var(--sd-color-gray-200, #f2f2f2);
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
  overflow-y: auto;
}
.reply-input-wrapper :deep(.comment-entry) {
  border-radius: 0;
}
.reply-input-wrapper :deep(.input-section) {
  margin: 0;
}
.reply-input-wrapper :deep(.superdoc-field) {
  font-size: 14px;
  border: none;
  padding: 0;
  border-radius: 0;
}
.reply-input-wrapper :deep(.superdoc-field:focus),
.reply-input-wrapper :deep(.superdoc-field:active) {
  border: none;
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
