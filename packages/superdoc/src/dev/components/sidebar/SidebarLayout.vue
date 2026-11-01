<script setup lang="ts">
defineProps({
  useWebLayout: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'toggle-web-layout']);

const closeSidebar = () => {
  emit('close');
};
</script>

<template>
  <div class="dev-sidebar">
    <div class="dev-sidebar__header">
      <div class="dev-sidebar__title-row">
        <h3 class="dev-sidebar__title">Layout</h3>
        <button class="dev-sidebar__close" type="button" aria-label="Close sidebar" @click="closeSidebar">×</button>
      </div>
    </div>

    <div class="dev-sidebar__body">
      <section class="dev-sidebar__section">
        <h4 class="dev-sidebar__section-title">
          <span class="dev-sidebar__section-icon dev-sidebar__section-icon--layout" aria-hidden="true">▦</span>
          <span>Layout</span>
        </h4>
        <div class="dev-sidebar__actions">
          <button class="dev-sidebar__button" type="button" @click="emit('toggle-web-layout')">
            Turn Web Layout {{ useWebLayout ? 'off' : 'on' }} (reloads)
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dev-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: #0f172a;
}

.dev-sidebar__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dev-sidebar__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dev-sidebar__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.dev-sidebar__close {
  border: none;
  background: transparent;
  color: #475569;
  font-size: 18px;
  font-weight: 700;
  padding: 0;
  line-height: 1;
  cursor: pointer;
}

.dev-sidebar__close:hover {
  color: #0f172a;
}

.dev-sidebar__body {
  display: grid;
  gap: 12px;
}

.dev-sidebar__section {
  display: grid;
  gap: 10px;
}

.dev-sidebar__section + .dev-sidebar__section {
  border-top: 1px solid rgba(148, 163, 184, 0.45);
  margin-top: 4px;
  padding-top: 18px;
}

.dev-sidebar__section-title {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
}

.dev-sidebar__section-icon {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.dev-sidebar__section-icon--layout {
  border: 1px solid rgba(59, 130, 246, 0.5);
  color: #1d4ed8;
  background: rgba(59, 130, 246, 0.12);
}

.dev-sidebar__actions {
  display: grid;
  gap: 8px;
}

.dev-sidebar__button {
  border: 1px solid rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.12);
  color: #1e3a8a;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    transform 0.1s ease;
}

.dev-sidebar__button:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.6);
}

.dev-sidebar__button:active:not(:disabled) {
  transform: translateY(1px);
}

.dev-sidebar__button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
