<script setup lang="ts">
import { formatDate } from './helpers';
import { superdocIcons } from '../../icons.js';
import { computed } from 'vue';
import type { PropType } from 'vue';
import { actorIdentitiesMatch, getActorIdentity, normalizeActorName } from '@superdoc/common';
import { isAllowed, PERMISSIONS } from '../../core/collaboration/permissions.js';
import { useCommentsStore } from '../../stores/comments-store';
import Avatar from '../general/Avatar.vue';
import { useUiFontFamily } from '../../composables/useUiFontFamily.js';
import { useSuperDocInstance } from '../../composables/use-superdoc-instance';
import CommentsDropdown from './CommentsDropdown.vue';
import { trackedChangeThreadParentIdForComment } from './tracked-change-threading.js';
import type { CommentModel } from './use-comment';

type HeaderConfig = { readOnly?: boolean; allowResolve?: boolean };

type HeaderCommentsStore = { pendingComment: object | null };

const emit = defineEmits(['resolve', 'reject', 'reopen', 'overflow-select']);
const commentsStore: HeaderCommentsStore = useCommentsStore();
const props = defineProps({
  timestamp: {
    type: Number,
    required: false,
  },
  config: {
    type: Object as PropType<HeaderConfig>,
    required: true,
  },
  comment: {
    type: Object as PropType<CommentModel>,
    required: true,
  },
  isPendingInput: {
    type: Boolean,
    required: false,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  // ui-phase3-002: stable reason for disabling resolve / reject. When set,
  // the buttons render in a disabled state and emit nothing. Used by v2 mode
  // to keep tracked-change accept/reject controls visible-but-disabled until
  // Phase 3 / 003 wires the tracked-change adapter.
  resolveDisabledReason: {
    type: String as PropType<string | null>,
    default: null,
  },
  rejectDisabledReason: {
    type: String as PropType<string | null>,
    default: null,
  },
  // Row 864 reopen: when set, the reopen affordance renders disabled (e.g.
  // read-only document or the v2 host reports writes are unavailable) and
  // emits nothing on click. When null, the affordance is interactive.
  reopenDisabledReason: {
    type: String as PropType<string | null>,
    default: null,
  },
  // Row 864 reopen: gate the reopen affordance so it only renders where a
  // working reopen path exists. The v2 sidebar sets this true; v1 leaves it
  // false so its resolved-comment behavior is unchanged.
  reopenSupported: {
    type: Boolean,
    default: false,
  },
  // TCS Phase 0 / 004 §5: stable reason for disabling overflow Edit / Delete
  // when the v2 host reports `canWrite === false` (e.g. author-required,
  // host not ready). Both options are filtered out of the overflow menu so
  // the user cannot trigger a mutation that the host will reject.
  writeDisabledReason: {
    type: String as PropType<string | null>,
    default: null,
  },
});

const { proxy, superdoc } = useSuperDocInstance();
const role = superdoc.config.role;
const isInternal = superdoc.config.isInternal;
const isCommentOwnedByCurrentUser = (comment: CommentModel) => {
  const currentUser = proxy.$superdoc.config.user;
  const otherUser = { id: comment?.creatorId, email: comment?.creatorEmail };
  if (actorIdentitiesMatch({ current: currentUser, other: otherUser })) return true;

  const currentIdentity = getActorIdentity(currentUser);
  const otherIdentity = getActorIdentity(otherUser);
  if (currentIdentity.hasId || currentIdentity.hasEmail || otherIdentity.hasId || otherIdentity.hasEmail) {
    return false;
  }

  const hasImportOrigin = comment?.origin != null || Boolean(comment?.importedAuthor?.name);
  if (hasImportOrigin) return false;

  const currentName = normalizeActorName(currentUser?.name);
  const commentName = normalizeActorName(comment?.creatorName);
  return Boolean(currentName && commentName && currentName === commentName);
};
const isTrackedChangeOwnedByCurrentUser = (comment: CommentModel) => {
  const currentUser = proxy.$superdoc.config.user;
  const current = getActorIdentity(currentUser);
  const author = getActorIdentity({
    id: comment?.creatorId,
    email: comment?.creatorEmail,
    name: comment?.creatorName,
  });
  if (current.hasId && author.hasId) {
    return current.id.toLowerCase() === author.id.toLowerCase();
  }
  if (current.hasEmail && author.hasEmail) {
    return current.email === author.email;
  }
  if (current.hasId || current.hasEmail || author.hasId || author.hasEmail) {
    return false;
  }
  const authorName = normalizeActorName(comment?.creatorName);
  if (!authorName) return true;
  const currentName = normalizeActorName(currentUser?.name);
  return Boolean(currentName && currentName === authorName);
};
const isOwnComment = computed(() => {
  if (props.comment?.trackedChange) return isTrackedChangeOwnedByCurrentUser(props.comment);
  return isCommentOwnedByCurrentUser(props.comment);
});
const trackedChangeThreadParentId = computed(() => trackedChangeThreadParentIdForComment(props.comment));

const { uiFontFamily } = useUiFontFamily();

const OVERFLOW_OPTIONS = Object.freeze({
  edit: { label: 'Edit', key: 'edit' },
  delete: { label: 'Delete', key: 'delete' },
});

type OverflowOption = (typeof OVERFLOW_OPTIONS)[keyof typeof OVERFLOW_OPTIONS];

const commentMutationsVisible = computed(() => props.config.readOnly !== true);
const trackedChangeDecisionsVisible = computed(() => {
  const allowDecisions = proxy.$superdoc?.interactionConfig?.trackedChanges?.allowDecisions;
  if (typeof allowDecisions === 'boolean') return allowDecisions;
  return commentMutationsVisible.value;
});

const generallyAllowed = computed(() => {
  if (!props.comment) return false;
  if (props.comment.resolvedTime) return false;
  if (commentsStore.pendingComment) return false;
  if (props.isPendingInput) return false;
  return true;
});

const resolveIsDisabled = () => props.config.allowResolve === false;

const allowResolve = computed(() => {
  if (!generallyAllowed.value) return false;
  if (props.comment.trackedChange) {
    if (!trackedChangeDecisionsVisible.value) return false;
  } else if (!commentMutationsVisible.value || resolveIsDisabled()) {
    return false;
  }

  // Do not allow child comments to resolve. An explicit tracked-change
  // conversation member has no native Word parentCommentId, but remains a
  // child of the review row through its persisted thread provenance.
  if (props.comment.parentCommentId) return false;
  if (trackedChangeThreadParentId.value) return false;

  const context = {
    comment: props.comment,
    currentUser: proxy.$superdoc.config.user,
    superdoc: proxy.$superdoc,
  };

  if (isOwnComment.value) {
    return isAllowed(PERMISSIONS.RESOLVE_OWN, role, isInternal, context);
  }
  return isAllowed(PERMISSIONS.RESOLVE_OTHER, role, isInternal, context);
});

const allowReject = computed(() => {
  if (!generallyAllowed.value) return false;
  if (!props.comment.trackedChange) return false;
  if (!trackedChangeDecisionsVisible.value) return false;

  const context = {
    comment: props.comment,
    currentUser: proxy.$superdoc.config.user,
    superdoc: proxy.$superdoc,
  };

  if (isOwnComment.value) {
    return isAllowed(PERMISSIONS.REJECT_OWN, role, isInternal, context);
  }
  return isAllowed(PERMISSIONS.REJECT_OTHER, role, isInternal, context);
});

// Row 864 reopen: a resolved root comment may be reopened (the inverse of
// resolve). `generallyAllowed` is intentionally false for resolved comments,
// so reopen has its own gate. Replies, tracked-change linkage, and pending
// input never expose reopen. Reopen reuses the resolve permission because it
// is the symmetric lifecycle inverse of resolve.
const allowReopen = computed(() => {
  if (!commentMutationsVisible.value) return false;
  if (resolveIsDisabled()) return false;
  if (!props.reopenSupported) return false;
  if (!props.comment) return false;
  if (!props.comment.resolvedTime) return false;
  if (commentsStore.pendingComment) return false;
  if (props.isPendingInput) return false;
  if (props.comment.parentCommentId) return false;
  if (trackedChangeThreadParentId.value) return false;
  if (props.comment.trackedChange) return false;

  const context = {
    comment: props.comment,
    currentUser: proxy.$superdoc.config.user,
    superdoc: proxy.$superdoc,
  };

  if (isOwnComment.value) {
    return isAllowed(PERMISSIONS.RESOLVE_OWN, role, isInternal, context);
  }
  return isAllowed(PERMISSIONS.RESOLVE_OTHER, role, isInternal, context);
});

const allowOverflow = computed(() => {
  if (!generallyAllowed.value) return false;
  if (props.comment.trackedChange) return false;
  if (props.isPendingInput) return false;
  if (getOverflowOptions.value.length === 0) return false;

  return true;
});

const getOverflowOptions = computed(() => {
  if (!commentMutationsVisible.value) return [];
  if (!generallyAllowed.value) return [];

  // TCS Phase 0 / 004 §5: when the v2 host blocks write (e.g. author-required,
  // host not ready), hide overflow Edit and Delete so the user cannot trigger
  // a mutation the host would immediately reject.
  if (props.writeDisabledReason) return [];

  const allowedOptions: OverflowOption[] = [];
  const options = new Set<keyof typeof OVERFLOW_OPTIONS>();

  // Only the comment creator can edit.
  if (isCommentOwnedByCurrentUser(props.comment)) {
    options.add('edit');
  }

  const isOwnComment = isCommentOwnedByCurrentUser(props.comment);

  const context = {
    comment: props.comment,
    currentUser: proxy.$superdoc.config.user,
    superdoc: proxy.$superdoc,
  };

  if (isOwnComment && isAllowed(PERMISSIONS.COMMENTS_DELETE_OWN, role, isInternal, context)) {
    options.add('delete');
  } else if (!isOwnComment && isAllowed(PERMISSIONS.COMMENTS_DELETE_OTHER, role, isInternal, context)) {
    options.add('delete');
  }

  options.forEach((option) => allowedOptions.push(OVERFLOW_OPTIONS[option]));
  return allowedOptions;
});

const handleResolve = () => {
  if (props.comment?.trackedChange) {
    if (!trackedChangeDecisionsVisible.value) return;
  } else if (!commentMutationsVisible.value || resolveIsDisabled()) {
    return;
  }
  if (props.resolveDisabledReason) return;
  emit('resolve');
};
const handleReject = () => {
  if (!trackedChangeDecisionsVisible.value) return;
  if (props.rejectDisabledReason) return;
  emit('reject');
};
const handleReopen = () => {
  if (!commentMutationsVisible.value || resolveIsDisabled()) return;
  if (props.reopenDisabledReason) return;
  emit('reopen');
};
const handleSelect = (value: string) => {
  if (!commentMutationsVisible.value) return;
  emit('overflow-select', value);
};

// Imported comments have `origin` set (e.g. 'word'); imported tracked changes
// don't carry `origin` but do carry `importedAuthor` from the mark attributes.
// SD-2528: suppress the IMPORTED tag when the current user is the author —
// re-opening your own exported file shouldn't relabel your own comments as
// "imported"; that visual churn is what made round-tripping look broken.
const isImported = computed(() => {
  const hasImportOrigin = props.comment.origin != null || !!props.comment.importedAuthor?.name;
  if (!hasImportOrigin) return false;
  if (isCommentOwnedByCurrentUser(props.comment)) return false;
  return true;
});

const getCurrentUser = computed(() => {
  if (props.isPendingInput) return proxy.$superdoc.config.user;
  const user = props.comment.getCommentUser();
  // Strip "(imported)" qualifier from display name — the imported tag handles origin indication
  if (user?.name) {
    const cleaned = user.name.replace(/\s*\(imported\)\s*/gi, '').trim();
    if (cleaned) return { ...user, name: cleaned };
  }
  return user;
});
</script>

<template>
  <div class="card-section comment-header">
    <div class="comment-header-left">
      <Avatar :user="getCurrentUser" class="avatar" />
      <div class="user-info">
        <div class="user-name">
          {{ getCurrentUser.name }}<span v-if="isImported" class="imported-tag">IMPORTED</span>
        </div>
        <div class="user-timestamp" v-if="props.comment.createdTime">{{ formatDate(props.comment.createdTime) }}</div>
      </div>
    </div>

    <!-- Action buttons — visible on card hover and when active -->
    <div class="overflow-menu" :class="{ 'is-visible': props.isActive }">
      <div
        v-if="allowResolve"
        class="overflow-menu__icon"
        data-comment-action="resolve"
        :class="{ 'sd-is-disabled': Boolean(resolveDisabledReason) }"
        :data-disabled-reason="resolveDisabledReason || null"
        :aria-disabled="Boolean(resolveDisabledReason)"
        v-html="superdocIcons.markDone"
        @click.stop.prevent="handleResolve"
      ></div>

      <div
        v-if="allowReject"
        class="overflow-menu__icon"
        data-comment-action="reject"
        :class="{ 'sd-is-disabled': Boolean(rejectDisabledReason) }"
        :data-disabled-reason="rejectDisabledReason || null"
        :aria-disabled="Boolean(rejectDisabledReason)"
        v-html="superdocIcons.rejectChange"
        @click.stop.prevent="handleReject"
      ></div>

      <div
        v-if="allowReopen"
        class="overflow-menu__icon overflow-menu__icon--reopen"
        :class="{ 'sd-is-disabled': Boolean(reopenDisabledReason) }"
        :data-disabled-reason="reopenDisabledReason || null"
        :data-comment-reopen="true"
        :aria-disabled="Boolean(reopenDisabledReason)"
        title="Reopen comment"
        v-html="superdocIcons.reopen"
        @click.stop.prevent="handleReopen"
      ></div>

      <CommentsDropdown
        v-if="allowOverflow"
        data-comment-action="overflow"
        :options="getOverflowOptions"
        @select="handleSelect"
        :content-style="{ fontFamily: uiFontFamily }"
      >
        <div class="overflow-menu__icon">
          <div class="overflow-icon" v-html="superdocIcons.overflow"></div>
        </div>
      </CommentsDropdown>
    </div>
  </div>
</template>

<style scoped>
.comment-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.comment-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.user-info {
  display: flex;
  flex-direction: column;
}
.user-name {
  font-size: var(--sd-ui-comments-author-size, 14px);
  font-weight: var(--sd-ui-comments-author-weight, 600);
  color: var(--sd-ui-comments-author-text, #212121);
  line-height: 1.2em;
}
.imported-tag {
  display: inline-block;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-ui-comments-tag-text, #888888);
  background: var(--sd-ui-comments-tag-bg, #f2f2f2);
  border-radius: 3px;
  padding: 1px 4px;
  margin-left: 6px;
  vertical-align: middle;
  line-height: 1.4;
}
.user-timestamp {
  line-height: 1.2em;
  font-size: var(--sd-ui-comments-timestamp-size, 12px);
  color: var(--sd-ui-comments-timestamp-text, #888888);
}
.overflow-menu {
  flex-shrink: 1;
  display: flex;
  gap: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}
.overflow-menu.is-visible {
  opacity: 1;
  pointer-events: auto;
}
.overflow-menu__icon {
  display: flex;
  box-sizing: content-box;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  padding: 3px;
  border-radius: 50%;
  color: var(--sd-ui-text, #47484a);
  cursor: pointer;
  transition: all 250ms ease;
}
.overflow-menu__icon:hover {
  background-color: var(--sd-ui-comments-separator, #dbdbdb);
}
.overflow-menu__icon.sd-is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: auto;
}
.overflow-menu__icon.sd-is-disabled:hover {
  background-color: transparent;
}
.overflow-menu__icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  fill: currentColor;
}
.overflow-icon {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  width: 10px;
  height: 16px;
}
</style>
