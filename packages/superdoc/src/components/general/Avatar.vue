<script setup lang="ts">
import type { PropType } from 'vue';
import type { User } from '../../core/types/index.js';

const props = defineProps({
  user: {
    type: Object as PropType<User>,
    required: true,
  },
});

const getInitials = (name: User['name'], email: User['email']) => {
  if (!name && !email) return;
  if (name) {
    // Filter to only words that start with a letter (skip parenthesized qualifiers like "(imported)")
    const parts = name
      .trim()
      .split(/\s+/)
      .filter((p) => /^[a-zA-Z]/.test(p));
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1) return parts[0][0].toUpperCase();
  }
  return email?.substring(0, 1)?.toUpperCase() || null;
};
</script>

<template>
  <div class="user-container">
    <img
      class="user-bg"
      v-if="user.image"
      :src="user.image.startsWith('http') ? user.image : `data:image/png;base64,${user.image}`"
    />
    <span class="user-bg" v-else>{{ getInitials(user.name, user.email) }}</span>
  </div>
</template>

<style scoped>
.user-container {
  border-radius: 50%;
  border: var(--sd-comment-avatar-border, 2px solid #333);
  font-size: var(--sd-comment-avatar-font-size, 11px);
  font-weight: 600;
  color: var(--sd-comment-avatar-color, #fff);
  background-color: var(--sd-comment-avatar-bg, #00000098);

  width: var(--sd-comment-avatar-size, 28px);
  height: var(--sd-comment-avatar-size, 28px);
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

img {
  border-radius: 50%;
  width: 100%;
  background-color: transparent;
}
</style>
