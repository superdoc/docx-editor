<script lang="ts">
let commentInputSequence = 0;
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { PropType, Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useCommentsStore } from '../../stores/comments-store';
import type { User } from '../../core/types/index.js';
import CommentHeader from './CommentHeader.vue';
import type { CommentModel } from './use-comment';

type InputConfig = { readOnly?: boolean; allowResolve?: boolean };

type MentionUser = User & { access?: string | { role?: string } | null };

type MentionIdentity = Pick<User, 'id' | 'name' | 'email'>;

type CommentInputStoreRefs = {
  currentCommentText: Ref<string>;
  currentCommentMentions: Ref<MentionIdentity[]>;
};

const TEXTAREA_MIN_HEIGHT = 28;
const TEXTAREA_MAX_HEIGHT = 132;

const emit = defineEmits(['focus']);
const props = defineProps({
  users: {
    type: Array as PropType<readonly MentionUser[]>,
    required: false,
    default: () => [],
  },
  config: {
    type: Object as PropType<InputConfig>,
    required: true,
  },
  isFocused: {
    type: Boolean,
    default: false,
  },
  includeHeader: {
    type: Boolean,
    default: true,
  },
  comment: {
    type: Object as PropType<CommentModel>,
    required: true,
  },
});
const commentsStore = useCommentsStore();
const { currentCommentText, currentCommentMentions }: CommentInputStoreRefs = storeToRefs(commentsStore);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const mentionStart = ref<number | null>(null);
const mentionQuery = ref('');
const highlightedMentionIndex = ref(0);
const mentionListId = `sd-comment-mention-list-${++commentInputSequence}`;

const handleFocusChange = (focused: boolean) => emit('focus', focused);

const getInputElement = () => inputRef.value;

const focus = (options?: FocusOptions) => {
  getInputElement()?.focus?.(options);
};

const syncInputHeight = () => {
  const input = getInputElement();
  if (!input) return;

  input.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
  const scrollHeight = input.scrollHeight || TEXTAREA_MIN_HEIGHT;
  const nextHeight = Math.min(Math.max(scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT);
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
};

const scheduleInputHeightSync = () => {
  nextTick(syncInputHeight);
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const htmlToText = (html: unknown) => {
  const value = String(html ?? '');
  if (!value || value === '<p></p>') return '';
  if (typeof document === 'undefined') {
    return value
      .replace(/<\/p>\s*<p\b[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
  }
  const element = document.createElement('div');
  element.innerHTML = value;
  element.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  element.querySelectorAll('p').forEach((paragraph, index) => {
    if (index > 0) paragraph.before('\n');
  });
  return element.textContent || '';
};

const textToHtml = (value: unknown) => {
  const normalized = String(value ?? '').replace(/\r\n/g, '\n');
  if (!normalized) return '<p></p>';
  return `<p>${escapeHtml(normalized).replace(/\n/g, '<br>')}</p>`;
};

const commentDraft = computed({
  get: () => htmlToText(currentCommentText.value),
  set: (value: string) => {
    currentCommentText.value = textToHtml(value);
  },
});

const displayName = (user: MentionIdentity) => user?.name?.trim() || user?.email?.trim() || '';
const userKey = (user: MentionIdentity) => String(user?.id ?? user?.email ?? user?.name ?? '');
const isViewer = (user: MentionUser) =>
  user?.role === 'viewer' ||
  user?.access === 'viewer' ||
  (typeof user?.access === 'object' && user.access?.role === 'viewer');
const mentionIdentity = (user: MentionUser): MentionIdentity => ({
  ...(user?.id != null ? { id: user.id } : {}),
  ...(user?.name != null ? { name: user.name } : {}),
  ...(user?.email != null ? { email: user.email } : {}),
});

const mentionSuggestions = computed(() => {
  if (mentionStart.value == null) return [];
  const needle = mentionQuery.value.toLocaleLowerCase();
  return props.users
    .filter((user) => !isViewer(user) && displayName(user))
    .filter((user) => {
      const name = displayName(user).toLocaleLowerCase();
      const email = user?.email?.toLocaleLowerCase() ?? '';
      return !needle || name.startsWith(needle) || email.startsWith(needle);
    })
    .slice(0, 8);
});
const mentionListOpen = computed(() => mentionSuggestions.value.length > 0);
const activeMentionOptionId = computed(() => {
  const user = mentionSuggestions.value[highlightedMentionIndex.value];
  return user ? `${mentionListId}-${userKey(user)}` : undefined;
});

const updateMentionQuery = (caret: number) => {
  const beforeCaret = commentDraft.value.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(beforeCaret);
  mentionStart.value = match ? caret - match[1].length - 1 : null;
  mentionQuery.value = match?.[1] ?? '';
  highlightedMentionIndex.value = 0;
};

const onInput = (event: Event) => {
  currentCommentMentions.value = currentCommentMentions.value.filter((user) =>
    commentDraft.value.includes(`@${displayName(user)}`),
  );
  const caret = event.target instanceof HTMLTextAreaElement ? event.target.selectionStart : null;
  updateMentionQuery(caret ?? commentDraft.value.length);
  syncInputHeight();
};

const selectMention = (user: MentionUser) => {
  if (mentionStart.value == null) return;
  const start = mentionStart.value;
  const caret = inputRef.value?.selectionStart ?? commentDraft.value.length;
  const token = `@${displayName(user)}`;
  const identity = mentionIdentity(user);
  commentDraft.value = `${commentDraft.value.slice(0, start)}${token}${commentDraft.value.slice(caret)}`;
  if (!currentCommentMentions.value.some((selected) => userKey(selected) === userKey(identity))) {
    currentCommentMentions.value = [...currentCommentMentions.value, identity];
  }
  mentionStart.value = null;
  mentionQuery.value = '';
  nextTick(() => {
    const nextCaret = start + token.length;
    inputRef.value?.focus();
    inputRef.value?.setSelectionRange(nextCaret, nextCaret);
    syncInputHeight();
  });
};

const onKeydown = (event: KeyboardEvent) => {
  if (!mentionListOpen.value) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    highlightedMentionIndex.value =
      (highlightedMentionIndex.value + direction + mentionSuggestions.value.length) % mentionSuggestions.value.length;
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    const user = mentionSuggestions.value[highlightedMentionIndex.value];
    if (user) selectMention(user);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    mentionStart.value = null;
  }
};

onMounted(scheduleInputHeightSync);
watch(currentCommentText, scheduleInputHeightSync);

defineExpose({ focus });
</script>

<template>
  <div class="input-section">
    <CommentHeader v-if="includeHeader" :config="config" :comment="comment" :is-pending-input="true" />

    <div class="comment-entry" :class="{ 'sd-input-active': isFocused }">
      <div class="comment-composer">
        <textarea
          ref="inputRef"
          v-model="commentDraft"
          class="superdoc-field"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="mentionListOpen"
          :aria-controls="mentionListOpen ? mentionListId : undefined"
          :aria-activedescendant="activeMentionOptionId"
          data-sd-comment-mention-input
          data-sd-comment-text
          placeholder="Add a comment"
          rows="1"
          @input="onInput"
          @keydown="onKeydown"
          @focus="handleFocusChange(true)"
          @blur="handleFocusChange(false)"
        />
        <div
          v-if="mentionListOpen"
          :id="mentionListId"
          class="comment-mention-list"
          role="listbox"
          data-sd-comment-mention-list
        >
          <button
            v-for="(user, index) in mentionSuggestions"
            :id="`${mentionListId}-${userKey(user)}`"
            :key="userKey(user)"
            type="button"
            class="comment-mention-option"
            :class="{ 'comment-mention-option--active': index === highlightedMentionIndex }"
            role="option"
            :aria-selected="index === highlightedMentionIndex"
            :data-sd-comment-mention-option="userKey(user)"
            @mousedown.prevent="selectMention(user)"
          >
            <span class="comment-mention-option__name">{{ displayName(user) }}</span>
            <span v-if="user.email" class="comment-mention-option__email">{{ user.email }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comment-entry {
  box-sizing: border-box;
  border-radius: 8px;
  width: 100%;
  max-width: 100%;
  transition: all 250ms ease;
}

.comment-composer {
  position: relative;
  min-width: 0;
}

.superdoc-field {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 28px;
  height: 28px;
  max-height: 132px;
  padding: 10px 12px;
  resize: none;
  border: 1px solid #d7d7d7;
  border-radius: 8px;
  color: #1f1f1f;
  background: #fff;
  font: inherit;
  line-height: 1.4;
  overflow-y: hidden;
}

.superdoc-field:focus {
  outline: none;
  border-color: #4f7cff;
  box-shadow: 0 0 0 2px rgba(79, 124, 255, 0.16);
}

.comment-mention-list {
  position: absolute;
  z-index: 100;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  overflow-y: auto;
  max-height: 192px;
  padding: 4px;
  border: 1px solid #d7d7d7;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
}

.comment-mention-option {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 5px;
  color: #1f1f1f;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.comment-mention-option--active,
.comment-mention-option:hover {
  background: #eef3ff;
}

.comment-mention-option__name {
  font-size: 13px;
  font-weight: 600;
}

.comment-mention-option__email {
  color: #666;
  font-size: 11px;
}
</style>
