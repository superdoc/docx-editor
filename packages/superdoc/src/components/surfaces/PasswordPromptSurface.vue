<script setup lang="ts">
import { ref, computed } from 'vue';
import type { PropType } from 'vue';
import type {
  PasswordPromptHandle,
  SurfaceComponentProps,
  SurfaceMode,
  SurfaceRequest,
} from '../../core/types/index.js';

const props = defineProps({
  // Reserved surface props (injected by SurfaceDialog)
  surfaceId: { type: String, default: '' },
  mode: { type: String as PropType<SurfaceMode>, default: 'dialog' },
  request: { type: Object as PropType<SurfaceRequest>, default: () => ({}) },
  resolve: { type: Function as PropType<SurfaceComponentProps['resolve']>, default: () => {} },
  close: { type: Function as PropType<SurfaceComponentProps['close']>, default: () => {} },
  // Feature-specific: the password prompt handle
  passwordPrompt: { type: Object as PropType<PasswordPromptHandle>, required: true },
});

const password = ref('');
const isBusy = ref(false);
const isInvalid = ref(props.passwordPrompt.errorCode === 'DOCX_PASSWORD_INVALID');
const errorMessage = ref(isInvalid.value ? props.passwordPrompt.texts.invalidMessage : '');

const heading = computed(() =>
  isInvalid.value ? props.passwordPrompt.texts.invalidTitle : props.passwordPrompt.texts.title,
);

const canSubmit = computed(() => password.value.length > 0 && !isBusy.value);

async function handleSubmit() {
  if (!canSubmit.value) return;

  isBusy.value = true;
  errorMessage.value = '';

  const result = await props.passwordPrompt.attemptPassword(password.value);

  if (result.success) {
    props.resolve({ password: password.value });
    return;
  }

  // Stay open — show error, let user retry
  isBusy.value = false;
  password.value = '';

  if (result.errorCode === 'DOCX_PASSWORD_INVALID') {
    isInvalid.value = true;
    errorMessage.value = props.passwordPrompt.texts.invalidMessage;
  } else if (result.errorCode === 'timeout') {
    errorMessage.value = props.passwordPrompt.texts.timeoutMessage;
  } else {
    errorMessage.value = props.passwordPrompt.texts.genericErrorMessage;
  }
}

function handleCancel() {
  props.close('user-cancelled');
}
</script>

<template>
  <div class="sd-password-prompt" @keydown.enter.prevent="handleSubmit">
    <h3 :id="`sd-password-prompt-heading-${surfaceId}`" class="sd-password-prompt__heading">{{ heading }}</h3>
    <p class="sd-password-prompt__description">{{ passwordPrompt.texts.description }}</p>

    <div class="sd-password-prompt__field">
      <input
        v-model="password"
        type="password"
        class="sd-password-prompt__input"
        :placeholder="passwordPrompt.texts.placeholder"
        :disabled="isBusy"
        autocomplete="current-password"
        :aria-label="passwordPrompt.texts.inputAriaLabel"
      />
    </div>

    <p v-if="errorMessage" class="sd-password-prompt__error" role="alert">
      {{ errorMessage }}
    </p>

    <div class="sd-password-prompt__actions">
      <button
        type="button"
        class="sd-password-prompt__btn sd-password-prompt__btn--cancel"
        :disabled="isBusy"
        @click="handleCancel"
      >
        {{ passwordPrompt.texts.cancelLabel }}
      </button>
      <button
        type="button"
        class="sd-password-prompt__btn sd-password-prompt__btn--submit"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        {{ isBusy ? passwordPrompt.texts.busyLabel : passwordPrompt.texts.submitLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sd-password-prompt {
  display: flex;
  flex-direction: column;
  gap: var(--sd-ui-password-prompt-gap, 12px);
}

.sd-password-prompt__heading {
  margin: 0;
  font-size: var(--sd-ui-password-prompt-heading-size, 15px);
  font-weight: var(--sd-ui-password-prompt-heading-weight, 600);
  line-height: 1.4;
  color: var(--sd-ui-password-prompt-heading-color, var(--sd-ui-text));
}

.sd-password-prompt__description {
  margin: 0;
  font-size: var(--sd-ui-password-prompt-description-size, 14px);
  line-height: 1.5;
  color: var(--sd-ui-password-prompt-description-color, var(--sd-ui-text));
}

.sd-password-prompt__field {
  display: flex;
}

.sd-password-prompt__input {
  width: 100%;
  padding: var(--sd-ui-password-prompt-input-padding, 8px 10px);
  font-size: var(--sd-ui-password-prompt-input-size, 14px);
  font-family: inherit;
  color: var(--sd-ui-password-prompt-input-color, var(--sd-ui-text));
  background: var(--sd-ui-password-prompt-input-bg, #fff);
  border: 1px solid var(--sd-ui-password-prompt-input-border, var(--sd-ui-border));
  border-radius: var(--sd-ui-password-prompt-input-radius, 4px);
  outline: none;
  transition: border-color 0.15s;
}

.sd-password-prompt__input:focus {
  border-color: var(--sd-ui-password-prompt-input-focus-border, var(--sd-ui-action));
}

.sd-password-prompt__input:disabled {
  opacity: var(--sd-ui-password-prompt-input-disabled-opacity, 0.6);
  cursor: not-allowed;
}

.sd-password-prompt__error {
  margin: 0;
  font-size: var(--sd-ui-password-prompt-error-size, 13px);
  color: var(--sd-ui-password-prompt-error-color, var(--sd-color-red-500, #ed4337));
}

.sd-password-prompt__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sd-ui-password-prompt-actions-gap, 8px);
  margin-top: 4px;
}

.sd-password-prompt__btn {
  padding: var(--sd-ui-password-prompt-btn-padding, 6px 16px);
  font-size: var(--sd-ui-password-prompt-btn-size, 14px);
  font-family: inherit;
  border-radius: var(--sd-ui-password-prompt-btn-radius, 4px);
  cursor: pointer;
  transition:
    background-color 0.15s,
    opacity 0.15s;
}

.sd-password-prompt__btn:disabled {
  opacity: var(--sd-ui-password-prompt-btn-disabled-opacity, 0.5);
  cursor: not-allowed;
}

.sd-password-prompt__btn--cancel {
  background: var(--sd-ui-password-prompt-cancel-bg, transparent);
  border: 1px solid var(--sd-ui-password-prompt-cancel-border, var(--sd-ui-border));
  color: var(--sd-ui-password-prompt-cancel-color, var(--sd-ui-text));
}

.sd-password-prompt__btn--cancel:hover:not(:disabled) {
  background: var(--sd-ui-password-prompt-cancel-hover-bg, var(--sd-color-gray-100, #f5f5f5));
}

.sd-password-prompt__btn--submit {
  background: var(--sd-ui-password-prompt-submit-bg, var(--sd-ui-action));
  border: 1px solid var(--sd-ui-password-prompt-submit-border, var(--sd-ui-action));
  color: var(--sd-ui-password-prompt-submit-color, var(--sd-ui-action-text, #fff));
}

.sd-password-prompt__btn--submit:hover:not(:disabled) {
  background: var(--sd-ui-password-prompt-submit-hover-bg, var(--sd-ui-action-hover));
}
</style>
