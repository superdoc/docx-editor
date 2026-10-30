<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { PropType, Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useCommentsStore } from '../../../stores/comments-store';
import CommentDialog from '../CommentDialog.vue';
import type { CommentModel } from '../use-comment';
import { isFiniteNumber } from '../../../helpers/is-finite-number.js';

export type PositionEntry = {
  pageIndex?: number | null;
  bounds?: { top?: number; bottom?: number } | null;
};

export type ReviewDirectoryItem = {
  id: string | undefined;
  comment: CommentModel;
  floatingInstanceId: string | null;
  floatingPageIndex: number | null | undefined;
  floatingPositionEntry: PositionEntry | null;
  isFloatingInstanceActive: boolean | undefined;
  threadComments: CommentModel[];
};

type ReviewDirectoryItemStoreRefs = {
  activeComment: Ref<string | null | undefined>;
  editingCommentId: Ref<string | null | undefined>;
  pendingComment: Ref<CommentModel | null>;
};

const props = defineProps({
  item: { type: Object as PropType<ReviewDirectoryItem>, required: true },
  index: { type: Number, required: true },
  total: { type: Number, required: true },
  tabIndex: { type: Number, default: -1 },
});
const emit = defineEmits(['focus-item', 'navigate']);

const commentsStore = useCommentsStore();
const { activeComment, editingCommentId, pendingComment }: ReviewDirectoryItemStoreRefs = storeToRefs(commentsStore);
const shell = ref<HTMLElement | null>(null);
const measuredHeight = ref(112);
const intersects = ref(typeof IntersectionObserver === 'undefined');
const containsFocus = ref(false);
let intersectionObserver: IntersectionObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

const threadIds = computed(
  () =>
    new Set(
      (props.item.threadComments ?? [])
        .flatMap((comment) => [comment?.commentId, comment?.importedId, comment?.trackedChangeCanonicalId])
        .filter((id) => id != null)
        .map(String),
    ),
);
const isPinned = computed(() => {
  const pendingId = pendingComment.value?.commentId;
  return (
    containsFocus.value ||
    (activeComment.value != null && threadIds.value.has(String(activeComment.value))) ||
    (editingCommentId.value != null && threadIds.value.has(String(editingCommentId.value))) ||
    (pendingId != null && threadIds.value.has(String(pendingId)))
  );
});
const materialized = computed(() => intersects.value || isPinned.value);
const placeholderStyle = computed(() =>
  materialized.value ? undefined : { minHeight: `${Math.max(1, measuredHeight.value)}px` },
);
const accessibleSummary = computed(() => {
  const comment = props.item.comment;
  const text = comment?.trackedChangeLabel ?? comment?.commentText ?? comment?.trackedChangeText ?? 'Review item';
  return (
    String(text)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160) || 'Review item'
  );
});

const measure = () => {
  const height = shell.value?.getBoundingClientRect?.().height;
  if (isFiniteNumber(height) && height > 0) measuredHeight.value = height;
};

const onFocusIn = () => {
  containsFocus.value = true;
  emit('focus-item', props.index);
};

const onFocusOut = (event: FocusEvent) => {
  containsFocus.value = event.relatedTarget instanceof Node && shell.value?.contains(event.relatedTarget) === true;
};

const onKeydown = (event: KeyboardEvent) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  if (
    event.target instanceof Element &&
    event.target.closest('input, textarea, select, button, [contenteditable="true"]')
  )
    return;
  event.preventDefault();
  emit('navigate', { index: props.index, key: event.key });
};

onMounted(() => {
  const element = shell.value;
  if (!element) return;
  if (typeof IntersectionObserver !== 'undefined') {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        intersects.value = entry.isIntersecting;
        if (entry.isIntersecting) void nextTick(measure);
      },
      { root: null, rootMargin: '600px 0px' },
    );
    intersectionObserver.observe(element);
  }
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
  }
  void nextTick(measure);
});

onBeforeUnmount(() => {
  intersectionObserver?.disconnect();
  resizeObserver?.disconnect();
});
</script>

<template>
  <div
    ref="shell"
    class="comment-item"
    role="listitem"
    :tabindex="tabIndex"
    :aria-posinset="index + 1"
    :aria-setsize="total"
    :aria-label="accessibleSummary"
    :style="placeholderStyle"
    :data-comment-instance-id="item.floatingInstanceId ?? ''"
    :data-comment-thread-id="item.comment.commentId ?? ''"
    :data-comment-position-key="item.comment.trackedChangeAnchorKey ?? ''"
    :data-comment-page-index="Number.isFinite(item.floatingPageIndex) ? item.floatingPageIndex : ''"
    :data-review-directory-index="index"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @keydown="onKeydown"
  >
    <CommentDialog
      v-if="materialized"
      :comment="item.comment"
      :thread-comments="item.threadComments"
      :floating-instance-id="item.floatingInstanceId"
      :floating-page-index="item.floatingPageIndex"
      :floating-position-entry="item.floatingPositionEntry"
      :is-floating-instance-active="item.isFloatingInstanceActive"
      @resize="measure"
    />
  </div>
</template>

<style scoped>
.comment-item {
  margin-bottom: 10px;
}
</style>
