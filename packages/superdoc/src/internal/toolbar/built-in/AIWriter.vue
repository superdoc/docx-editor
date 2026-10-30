<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { PropType } from 'vue';
import type { SelectionTarget } from '@superdoc/document-api';
import { isPlainObject } from '../../../helpers/object-guards.js';

interface AiWriterDocument {
  replace?: (input: { target: SelectionTarget; text: string }) => unknown;
  insert?: (input: { target?: SelectionTarget; value: string; type: 'text' }) => unknown;
}

const DEFAULT_AI_ENDPOINT = 'https://sd-dev-express-gateway-i6xtm.ondigitalocean.app/insights';
const SYSTEM_PROMPT =
  'You are an expert copywriter and you are immersed in a document editor. Only write what is asked for.';

const props = defineProps({
  selectedText: {
    type: String,
    default: '',
  },
  target: {
    type: Object as PropType<SelectionTarget | null>,
    default: null,
  },
  doc: {
    type: Object as PropType<AiWriterDocument | null>,
    default: null,
  },
  apiKey: {
    type: String,
    default: '',
  },
  endpoint: {
    type: String,
    default: '',
  },
  restoreSelection: {
    type: Function as PropType<() => void>,
    default: null,
  },
  handleClose: {
    type: Function as PropType<() => void>,
    required: true,
  },
});

const promptText = ref('');
const isLoading = ref(false);
const errorMessage = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const placeholderText = computed(() =>
  props.selectedText ? 'Insert prompt to update text' : 'Insert prompt to generate text',
);
const canSubmit = computed(() => promptText.value.trim().length > 0 && !isLoading.value);

onMounted(() => {
  nextTick(() => {
    textareaRef.value?.focus();
  });
});

function extractGeneratedText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!isPlainObject(payload)) return '';

  const customPrompt = payload.custom_prompt;
  if (Array.isArray(customPrompt)) {
    const first: unknown = customPrompt[0];
    if (isPlainObject(first) && typeof first.value === 'string') return first.value;
  }
  if (isPlainObject(customPrompt) && typeof customPrompt.value === 'string') {
    return customPrompt.value;
  }
  if (typeof payload.value === 'string') return payload.value;
  if (typeof payload.text === 'string') return payload.text;
  return '';
}

async function requestAiText(prompt: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (props.apiKey) headers['x-api-key'] = props.apiKey;

  const selectedText = props.selectedText.trim();
  const message = selectedText
    ? `Rewrite the following text: "${selectedText}" using these instructions: ${prompt}`
    : `Generate text based on the following prompt: ${prompt}`;

  const response = await fetch(props.endpoint || DEFAULT_AI_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      stream: false,
      context: SYSTEM_PROMPT,
      insights: [
        {
          type: 'custom_prompt',
          name: selectedText ? 'text_rewrite' : 'text_generation',
          message,
          format: [{ value: '' }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `AI request failed with ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  const generated = extractGeneratedText(payload).trim();
  if (!generated) throw new Error('AI returned no text.');
  return generated;
}

function receiptSucceeded(receipt: unknown) {
  if (!receipt || typeof receipt !== 'object') return true;
  if (('success' in receipt && receipt.success === false) || ('ok' in receipt && receipt.ok === false)) return false;
  return true;
}

function insertGeneratedText(text: string) {
  const doc = props.doc;
  if (!doc) throw new Error('Document API is unavailable.');

  props.restoreSelection?.();

  let receipt = null;
  let handled = false;
  if (props.selectedText && props.target && typeof doc.replace === 'function') {
    receipt = doc.replace({ target: props.target, text });
    handled = true;
  } else if (props.target && typeof doc.insert === 'function') {
    receipt = doc.insert({ target: props.target, value: text, type: 'text' });
    handled = true;
  } else if (typeof doc.insert === 'function') {
    receipt = doc.insert({ value: text, type: 'text' });
    handled = true;
  }

  if (!handled) throw new Error('Document text insertion is unavailable.');
  if (!receiptSucceeded(receipt)) throw new Error('Unable to insert generated text.');
}

async function handleSubmit() {
  if (!canSubmit.value) return;
  errorMessage.value = '';
  isLoading.value = true;
  try {
    const generatedText = await requestAiText(promptText.value.trim());
    insertGeneratedText(generatedText);
    props.handleClose();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    isLoading.value = false;
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  handleSubmit();
}
</script>

<template>
  <form class="sd-ai-writer" data-item="ai-writer" @submit.prevent="handleSubmit">
    <textarea
      ref="textareaRef"
      v-model="promptText"
      class="sd-ai-writer__input"
      :placeholder="placeholderText"
      rows="4"
      @keydown="handleKeydown"
    ></textarea>
    <div class="sd-ai-writer__footer">
      <p v-if="errorMessage" class="sd-ai-writer__error" role="alert">{{ errorMessage }}</p>
      <button class="sd-ai-writer__submit" type="submit" :disabled="!canSubmit">
        {{ isLoading ? 'Generating' : 'Generate' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.sd-ai-writer {
  width: 300px;
  padding: 12px;
  border: 1px solid #7715b3;
  border-radius: var(--sd-ui-radius, 6px);
  background: var(--sd-ui-dropdown-bg, #fff);
  box-shadow: 0 0 2px 2px #7715b366;
  box-sizing: border-box;
}

.sd-ai-writer__input {
  width: 100%;
  min-height: 76px;
  resize: vertical;
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  border-radius: 4px;
  box-sizing: border-box;
  color: var(--sd-ui-text, #47484a);
  font-family: var(--sd-ui-font-family, Arial, Helvetica, sans-serif);
  font-size: var(--sd-ui-font-size-300, 13px);
  line-height: 1.4;
  outline: none;
  padding: 8px;
}

.sd-ai-writer__input:focus {
  border-color: var(--sd-ui-action, #7715b3);
}

.sd-ai-writer__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.sd-ai-writer__error {
  flex: 1;
  margin: 0;
  color: #b42318;
  font-size: var(--sd-ui-font-size-200, 12px);
  line-height: 1.3;
}

.sd-ai-writer__submit {
  border: 1px solid var(--sd-ui-action, #7715b3);
  border-radius: 4px;
  background: var(--sd-ui-action, #7715b3);
  color: #fff;
  cursor: pointer;
  font-family: var(--sd-ui-font-family, Arial, Helvetica, sans-serif);
  font-size: var(--sd-ui-font-size-300, 13px);
  line-height: 1;
  padding: 7px 10px;
}

.sd-ai-writer__submit:disabled {
  cursor: default;
  opacity: 0.55;
}
</style>
