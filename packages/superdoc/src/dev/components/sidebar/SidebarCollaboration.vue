<script setup lang="ts">
defineProps({
  events: {
    type: Array,
    default: () => [],
  },
  providerStatus: {
    type: String,
    default: 'disabled',
  },
  collabRoom: {
    type: String,
    default: '',
  },
  roomMode: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['close', 'clear-collaboration-events']);

const closeSidebar = () => {
  emit('close');
};

const clearEvents = () => {
  emit('clear-collaboration-events');
};

const formatTimestamp = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const joinList = (values) => {
  if (!Array.isArray(values) || values.length === 0) return '';
  return values.join(', ');
};
</script>

<template>
  <div class="dev-sidebar">
    <div class="dev-sidebar__header">
      <div class="dev-sidebar__title-row">
        <h3 class="dev-sidebar__title">Collaboration</h3>
        <button class="dev-sidebar__close" type="button" aria-label="Close sidebar" @click="closeSidebar">×</button>
      </div>
      <p class="dev-sidebar__subtitle">V2 collaboration lifecycle and awareness for the current dev room.</p>
    </div>

    <div class="dev-sidebar__body">
      <section class="dev-sidebar__status-grid">
        <div class="dev-sidebar__status-card">
          <span class="dev-sidebar__status-label">Room</span>
          <span class="dev-sidebar__status-value dev-sidebar__status-value--mono">{{ collabRoom || 'unknown' }}</span>
        </div>
        <div class="dev-sidebar__status-card">
          <span class="dev-sidebar__status-label">Provider</span>
          <span class="dev-sidebar__status-value">{{ providerStatus }}</span>
        </div>
        <div class="dev-sidebar__status-card">
          <span class="dev-sidebar__status-label">Room mode</span>
          <span class="dev-sidebar__status-value">{{ roomMode || 'unknown' }}</span>
        </div>
      </section>

      <div class="dev-sidebar__actions">
        <button class="dev-sidebar__button" type="button" @click="clearEvents">Clear activity</button>
      </div>

      <section class="dev-sidebar__events">
        <div class="dev-sidebar__section-header">
          <h4 class="dev-sidebar__section-title">Recent events</h4>
          <span class="dev-sidebar__count">{{ events.length }}</span>
        </div>

        <p v-if="events.length === 0" class="dev-sidebar__hint">No collaboration activity captured yet.</p>

        <article v-for="event in events" :key="event.id" class="dev-sidebar__event">
          <div class="dev-sidebar__event-row">
            <span class="dev-sidebar__event-summary">{{ event.summary || 'Activity event' }}</span>
            <span class="dev-sidebar__event-time">{{ formatTimestamp(event.at) }}</span>
          </div>
          <div class="dev-sidebar__event-meta">
            <span class="dev-sidebar__event-pill" :class="`dev-sidebar__event-pill--${event.source || 'unknown'}`">
              {{ event.source || 'unknown' }}
            </span>
            <span v-if="event.origin" class="dev-sidebar__event-detail">origin: {{ event.origin }}</span>
            <span v-if="event.changeType" class="dev-sidebar__event-detail">change: {{ event.changeType }}</span>
            <span v-if="event.entryKey" class="dev-sidebar__event-detail">entry: {{ event.entryKey }}</span>
          </div>
          <p v-if="joinList(event.changedKeys)" class="dev-sidebar__event-text">
            keys: {{ joinList(event.changedKeys) }}
          </p>
          <p v-if="joinList(event.actors)" class="dev-sidebar__event-text">actors: {{ joinList(event.actors) }}</p>
          <p v-if="event.valueSummary" class="dev-sidebar__event-text">value: {{ event.valueSummary }}</p>
        </article>
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
  gap: 6px;
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

.dev-sidebar__subtitle {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
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
  gap: 14px;
}

.dev-sidebar__status-grid {
  display: grid;
  gap: 10px;
}

.dev-sidebar__status-card {
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 10px;
  background: #fff;
  padding: 12px;
  display: grid;
  gap: 4px;
}

.dev-sidebar__status-label {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.dev-sidebar__status-value {
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
}

.dev-sidebar__status-value--mono {
  font-family: 'SFMono-Regular', 'Menlo', 'Monaco', monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.dev-sidebar__actions {
  display: flex;
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

.dev-sidebar__button:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.6);
}

.dev-sidebar__button:active {
  transform: translateY(1px);
}

.dev-sidebar__events {
  display: grid;
  gap: 10px;
}

.dev-sidebar__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dev-sidebar__section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.dev-sidebar__count {
  min-width: 24px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.dev-sidebar__hint {
  margin: 0;
  color: #64748b;
  font-size: 12px;
}

.dev-sidebar__event {
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 10px;
  background: #fff;
  padding: 12px;
  display: grid;
  gap: 8px;
}

.dev-sidebar__event-row {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
}

.dev-sidebar__event-summary {
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
}

.dev-sidebar__event-time {
  color: #64748b;
  font-size: 11px;
  white-space: nowrap;
}

.dev-sidebar__event-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dev-sidebar__event-pill {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dev-sidebar__event-pill--client {
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
}

.dev-sidebar__event-pill--server {
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
}

.dev-sidebar__event-pill--unknown {
  background: rgba(100, 116, 139, 0.12);
  color: #475569;
}

.dev-sidebar__event-detail {
  color: #475569;
  font-size: 11px;
}

.dev-sidebar__event-text {
  margin: 0;
  color: #334155;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
</style>
