<script setup lang="ts">
import { ref } from 'vue';

const query = ref('');
const results = ref([]);
const hasSearched = ref(false);
const links = ref([]);
const hasScannedLinks = ref(false);

const emit = defineEmits(['close']);

const getEditor = () => window.editor ?? null;
const getSuperdoc = () => window.superdoc ?? null;
const hasDocumentApi = () => Boolean(getEditor()?.doc);
const getDocumentApiMessage = () =>
  getEditor()?.documentApiUnavailableReason || 'Document API unavailable in the current execution mode.';

const closeSidebar = () => {
  emit('close');
};

const runSearch = () => {
  const trimmedQuery = query.value.trim();
  if (!trimmedQuery) {
    results.value = [];
    hasSearched.value = false;
    return;
  }

  const queryApi = getEditor()?.doc?.query;
  if (typeof queryApi?.match !== 'function') {
    results.value = [];
    hasSearched.value = true;
    return;
  }

  const matchResult = queryApi.match({
    select: { type: 'text', pattern: trimmedQuery },
    require: 'all',
    limit: 100,
  });

  results.value = Array.isArray(matchResult?.items) ? matchResult.items : [];
  hasSearched.value = true;
};

const getSnippetPrefix = (match) => {
  const snippet = typeof match?.snippet === 'string' ? match.snippet : '';
  const start = match?.highlightRange?.start ?? 0;
  return snippet.slice(0, start);
};

const getSnippetMatch = (match) => {
  const snippet = typeof match?.snippet === 'string' ? match.snippet : '';
  const start = match?.highlightRange?.start ?? 0;
  const end = match?.highlightRange?.end ?? 0;
  return snippet.slice(start, end) || snippet;
};

const getSnippetSuffix = (match) => {
  const snippet = typeof match?.snippet === 'string' ? match.snippet : '';
  const end = match?.highlightRange?.end ?? 0;
  return snippet.slice(end);
};

const goToResult = async (match) => {
  const address = match?.address;
  if (address?.kind !== 'block') return;

  const navigateTo = getSuperdoc()?.navigateTo;
  if (typeof navigateTo !== 'function') return;

  await navigateTo({
    kind: 'block',
    nodeId: address.nodeId,
    ...(address.nodeType ? { nodeType: address.nodeType } : {}),
  });
};

const getLinkLabel = (item, index) => {
  const href = item?.properties?.href;
  const anchor = item?.properties?.anchor;
  const text = item?.text?.trim();

  if (typeof href === 'string' && href.length > 0) return href;
  if (typeof anchor === 'string' && anchor.length > 0) return `#${anchor}`;
  if (text) return text;
  return `Link ${index + 1}`;
};

const getLinkDetail = (item) => {
  const text = item?.text?.trim();
  const href = item?.properties?.href;
  if (text && text !== href) return text;
  return '';
};

const findLinks = () => {
  const hyperlinksApi = getEditor()?.doc?.hyperlinks;
  if (typeof hyperlinksApi?.list !== 'function') {
    links.value = [];
    hasScannedLinks.value = true;
    return;
  }

  const listResult = hyperlinksApi.list({ limit: 1000 });
  const items = Array.isArray(listResult?.items) ? listResult.items : [];

  links.value = items.map((item, index) => ({
    id: item?.id ?? `link-${index}`,
    label: getLinkLabel(item, index),
    detail: getLinkDetail(item),
    blockId: item?.address?.anchor?.start?.blockId ?? null,
  }));
  hasScannedLinks.value = true;
};

const goToLink = async (link) => {
  if (!link?.blockId) return;

  const navigateTo = getSuperdoc()?.navigateTo;
  if (typeof navigateTo !== 'function') return;

  await navigateTo({
    kind: 'block',
    nodeId: link.blockId,
  });
};
</script>

<template>
  <div class="dev-sidebar">
    <div class="dev-sidebar__header">
      <div class="dev-sidebar__title-row">
        <h3 class="dev-sidebar__title">Search</h3>
        <button class="dev-sidebar__close" type="button" aria-label="Close sidebar" @click="closeSidebar">×</button>
      </div>
    </div>
    <div class="dev-sidebar__body">
      <p v-if="!hasDocumentApi()" class="dev-sidebar__warning">
        {{ getDocumentApiMessage() }}
        Search and hyperlink discovery require inline v2 mode.
      </p>

      <label class="dev-sidebar__label" for="dev-sidebar-search">Query</label>
      <div class="dev-sidebar__search-row">
        <input
          id="dev-sidebar-search"
          v-model="query"
          class="dev-sidebar__input"
          type="text"
          placeholder="Search the document"
          @keydown.enter="runSearch"
        />
        <button
          class="dev-sidebar__button"
          type="button"
          :disabled="!hasDocumentApi() || !query.trim()"
          @click="runSearch"
        >
          Search
        </button>
      </div>
      <div class="dev-sidebar__results">
        <p v-if="!hasSearched" class="dev-sidebar__hint">Search results will appear here.</p>
        <p v-else-if="results.length === 0" class="dev-sidebar__hint">No results found.</p>
        <button
          v-for="(result, index) in results"
          :key="result.id || `${result.address?.nodeId || 'match'}-${index}`"
          class="dev-sidebar__result"
          type="button"
          @click="goToResult(result)"
        >
          <span class="dev-sidebar__result-index">{{ index + 1 }}.</span>
          <span class="dev-sidebar__result-text">
            <span class="dev-sidebar__snippet">{{ getSnippetPrefix(result) }}</span>
            <mark class="dev-sidebar__snippet-match">{{ getSnippetMatch(result) }}</mark>
            <span class="dev-sidebar__snippet">{{ getSnippetSuffix(result) }}</span>
          </span>
        </button>
      </div>

      <section class="dev-sidebar__section">
        <div class="dev-sidebar__section-header">
          <h4 class="dev-sidebar__section-title">Links</h4>
          <button class="dev-sidebar__button" type="button" :disabled="!hasDocumentApi()" @click="findLinks">
            Find links
          </button>
        </div>
        <div class="dev-sidebar__results">
          <p v-if="!hasScannedLinks" class="dev-sidebar__hint">Run "Find links" to list hyperlink nodes.</p>
          <p v-else-if="links.length === 0" class="dev-sidebar__hint">No links found.</p>
          <button
            v-for="(link, index) in links"
            :key="link.id"
            class="dev-sidebar__result"
            type="button"
            @click="goToLink(link)"
          >
            <span class="dev-sidebar__result-index">{{ index + 1 }}.</span>
            <span class="dev-sidebar__result-text">
              <span>{{ link.label }}</span>
              <span v-if="link.detail" class="dev-sidebar__result-detail">{{ link.detail }}</span>
            </span>
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
  gap: 10px;
}

.dev-sidebar__warning {
  margin: 0;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.12);
  color: #92400e;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.5;
}

.dev-sidebar__label {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.dev-sidebar__input {
  border: 1px solid rgba(148, 163, 184, 0.6);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
}

.dev-sidebar__input:focus {
  outline: 2px solid rgba(59, 130, 246, 0.4);
  border-color: rgba(59, 130, 246, 0.6);
}

.dev-sidebar__search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
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
  opacity: 0.55;
  cursor: not-allowed;
}

.dev-sidebar__results {
  display: grid;
  gap: 8px;
}

.dev-sidebar__section {
  display: grid;
  gap: 8px;
}

.dev-sidebar__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dev-sidebar__section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.dev-sidebar__hint {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.dev-sidebar__result {
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: #fff;
  color: inherit;
  border-radius: 10px;
  padding: 10px 12px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.1s ease;
}

.dev-sidebar__result:hover {
  border-color: rgba(59, 130, 246, 0.45);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
}

.dev-sidebar__result:active {
  transform: translateY(1px);
}

.dev-sidebar__result-index {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  padding-top: 2px;
}

.dev-sidebar__result-text {
  min-width: 0;
  display: grid;
  gap: 4px;
  font-size: 13px;
  line-height: 1.5;
}

.dev-sidebar__snippet {
  color: #334155;
}

.dev-sidebar__snippet-match {
  background: rgba(250, 204, 21, 0.45);
  color: #0f172a;
  border-radius: 4px;
  padding: 0 2px;
}

.dev-sidebar__result-detail {
  color: #64748b;
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
