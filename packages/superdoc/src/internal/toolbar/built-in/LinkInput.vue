<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { PropType, Ref } from 'vue';
import { sanitizeHref } from './url-safety.js';
import { toolbarIcons } from './toolbarIcons.js';
import { useHighContrastMode } from '../../../composables/use-high-contrast-mode';
import { executeFirstPartyCommandAsync } from '../../../public/ui/create-super-doc-ui.js';
import type { CommandExecutionResult, SuperDocUI } from '../../../public/ui/types.js';

type LinkInputUI = Partial<Pick<SuperDocUI, 'selection' | 'toolbar' | 'document'>> & Pick<SuperDocUI, 'commands'>;

interface LinkItem {
  attributes?: Ref<{ href?: unknown } | undefined>;
}

type LinkCommandResult = CommandExecutionResult | null | undefined;

interface LinkCommandPayload {
  href: string | null;
  hyperlinkTarget: object | null;
  currentText?: string;
  textTarget?: object | null;
  text?: string;
}

/**
 * Built-in link editing popover.
 *
 * V2-truthful rewrite of the v1 link popover: instead of reaching into the v1
 * editor (`editor.state`, `editor.view`, `editor.commands.toggleLink`), it reads
 * and drives the shared command controller (`ui`):
 *
 *   - current selected text  → `ui.selection.getSnapshot().quotedText`
 *   - current link href       → `ui.toolbar` snapshot `commands.link.value`
 *   - apply / edit            → `ui.commands.execute('link', { href, text })`
 *   - remove                  → `ui.commands.execute('link', { href: null })`
 *
 * The DOM contract (`.link-input-ctn`, `.link-title`, `btn-link-apply`,
 * `btn-link-remove`, `btn-link-open`, `input[name="link"]`) is preserved so the
 * proof lane and behavior tests keep working.
 */
const props = defineProps({
  showInput: {
    type: Boolean,
    default: true,
  },
  showLink: {
    type: Boolean,
    default: true,
  },
  goToAnchor: {
    type: Function as PropType<(anchorUrl: string) => unknown>,
    default: () => {},
  },
  /** The shared UI controller (single command-state truth). */
  ui: {
    type: Object as PropType<LinkInputUI | null>,
    default: null,
  },
  /** The built-in `link` toolbar item, for current-href fallback. */
  linkItem: {
    type: Object as PropType<LinkItem | null>,
    default: null,
  },
  closePopover: {
    type: Function as PropType<() => void>,
    default: () => {},
  },
  href: {
    type: String as PropType<string | null>,
    default: null,
  },
  target: {
    type: String as PropType<string | null>,
    default: null,
  },
  rel: {
    type: String as PropType<string | null>,
    default: null,
  },
  tooltip: {
    type: String as PropType<string | null>,
    default: null,
  },
  clickedElement: {
    type: Object as PropType<HTMLElement | null>,
    default: null,
  },
  hyperlinkTarget: {
    type: Object as PropType<object | null>,
    default: null,
  },
  hyperlinkText: {
    type: String as PropType<string | null>,
    default: null,
  },
  textTarget: {
    type: Object as PropType<object | null>,
    default: null,
  },
  selectedText: {
    type: String as PropType<string | null>,
    default: null,
  },
  /**
   * Re-applies the toolbar's pre-interaction selection capture before the link
   * command runs. LinkInput executes the command directly (bypassing Toolbar.vue's
   * handleCommand → restoreSelection), so without this the command would wrap
   * whatever selection remains after the dropdown interaction instead of the text
   * the user highlighted. Supplied by renderLinkDropdown.
   */
  restoreSelection: {
    type: Function as PropType<() => void>,
    default: () => {},
  },
  documentMode: {
    type: String as PropType<string | null>,
    default: null,
  },
});
const { isHighContrastMode } = useHighContrastMode();

const urlError = ref(false);
const commandError = ref('');
const isSubmitting = ref(false);

const readSelectedText = () => {
  if (typeof props.hyperlinkText === 'string' && props.hyperlinkText) return props.hyperlinkText;
  if (typeof props.selectedText === 'string' && props.selectedText) return props.selectedText;
  const snapshot = props.ui?.selection?.getSnapshot?.();
  if (typeof snapshot?.quotedText === 'string' && snapshot.quotedText) return snapshot.quotedText;
  const clickedText = props.clickedElement?.innerText ?? props.clickedElement?.textContent;
  return typeof clickedText === 'string' ? clickedText : '';
};

const readLinkHref = () => {
  if (typeof props.href === 'string' && props.href) return props.href;
  const value = props.ui?.toolbar?.getSnapshot?.()?.commands?.link?.value;
  if (typeof value === 'string' && value) return value;
  const attrHref = props.linkItem?.attributes?.value?.href;
  return typeof attrHref === 'string' ? attrHref : '';
};

const readDocumentMode = () => props.documentMode ?? props.ui?.document?.getSnapshot?.()?.mode ?? null;

const text = ref('');
const rawUrl = ref('');
const isAnchor = ref(false);

const HAS_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;

// Default to https:// when no scheme is specified. Validation stays centralized in sanitizeHref.
// Trim first: a pasted URL with surrounding whitespace (e.g. " https://superdoc.dev")
// would otherwise defeat the scheme check and get "https://" prepended onto a value
// that already has a scheme, producing "https:// https://..." (rendered as "%20https").
const url = computed(() => {
  const raw = rawUrl.value.trim();
  if (!raw) return '';
  if (raw.startsWith('#') || HAS_PROTOCOL.test(raw)) return raw;
  return 'https://' + raw;
});

const sanitizedUrl = computed(() => {
  if (!url.value) return null;
  return sanitizeHref(url.value);
});

const validUrl = computed(() => sanitizedUrl.value !== null);

const hadExistingLink = ref(false);
const isEditing = computed(() => !isAnchor.value && hadExistingLink.value);
const isDisabled = computed(() => !validUrl.value || isSubmitting.value);
const isViewingMode = computed(() => readDocumentMode() === 'viewing');

const openLink = () => {
  const href = sanitizedUrl.value?.href;
  if (!href) return;
  window.open(href, '_blank', 'noopener');
};

const focusInput = () => {
  const input = document.querySelector<HTMLInputElement>('.link-input-ctn input');
  if (!input) return;
  input.focus();
};

onMounted(() => {
  text.value = readSelectedText();
  rawUrl.value = readLinkHref();
  hadExistingLink.value = Boolean(rawUrl.value);
  isAnchor.value = rawUrl.value.startsWith('#');
  if (props.showInput && !isViewingMode.value) focusInput();
});

const runLinkCommand = async (payload: LinkCommandPayload): Promise<LinkCommandResult> => {
  const ui = props.ui;
  if (!ui?.commands?.executeAsync) return false;
  // Restore the pre-interaction selection so the command targets the highlighted
  // text. The explicit `textTarget` payload pins the range too, but restoring keeps
  // the document selection consistent for follow-up commands and existing-link
  // routing inside executeLinkCommand.
  props.restoreSelection?.();
  return executeFirstPartyCommandAsync(ui, 'link', payload);
};

const applyLinkCommand = async (payload: LinkCommandPayload) => {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  commandError.value = '';
  try {
    const result = await runLinkCommand(payload);
    if (result === false || result == null || (typeof result === 'object' && result.success === false)) {
      commandError.value = 'Could not apply link. Check the selection and try again.';
      return;
    }
    props.closePopover();
  } catch {
    commandError.value = 'Could not apply link. Check the selection and try again.';
  } finally {
    isSubmitting.value = false;
  }
};

const handleSubmit = async () => {
  if (isViewingMode.value || isSubmitting.value) return;

  // If the URL is cleared, simply remove the link.
  if (!rawUrl.value) {
    await applyLinkCommand({ href: null, hyperlinkTarget: props.hyperlinkTarget });
    return;
  }

  if (!validUrl.value) {
    urlError.value = true;
    return;
  }

  const href = sanitizedUrl.value?.href;
  if (!href) {
    urlError.value = true;
    return;
  }

  const payload: LinkCommandPayload = {
    href,
    currentText: readSelectedText(),
    hyperlinkTarget: props.hyperlinkTarget,
    textTarget: props.textTarget,
  };
  // Blank edit text must omit `text`; otherwise the link command would replace the existing label with the URL.
  if (text.value) {
    payload.text = text.value;
  } else if (!isEditing.value && !props.textTarget) {
    payload.text = href;
  }
  await applyLinkCommand(payload);
};

const handleRemove = async () => {
  if (isViewingMode.value || isSubmitting.value) return;
  await applyLinkCommand({ href: null, hyperlinkTarget: props.hyperlinkTarget });
};

const navigationError = ref('');
const navigateToAnchor = async (anchorUrl: string) => {
  navigationError.value = '';
  try {
    if ((await props.goToAnchor?.(anchorUrl)) === false) navigationError.value = 'Reference target is unavailable';
  } catch {
    navigationError.value = 'Reference target is unavailable';
  }
};
</script>

<template>
  <div class="link-input-ctn" :class="{ 'high-contrast': isHighContrastMode }">
    <div class="link-title" v-if="isAnchor">Page anchor</div>
    <div class="link-title" v-else-if="isViewingMode">Link details</div>
    <div class="link-title" v-else-if="isEditing">Edit link</div>
    <div class="link-title" v-else>Add link</div>

    <div v-if="showInput && !isAnchor" class="link-input-wrapper">
      <!-- Text input -->
      <div class="input-row text-input-row">
        <div class="input-icon text-input-icon">T</div>
        <input
          type="text"
          name="text"
          placeholder="Text"
          v-model="text"
          :readonly="isViewingMode"
          @keydown.enter.stop.prevent="handleSubmit"
        />
      </div>

      <!-- URL input -->
      <div class="input-row url-input-row">
        <div class="input-icon" v-html="toolbarIcons.linkInput"></div>
        <input
          type="text"
          name="link"
          placeholder="Type or paste a link"
          :class="{ 'sd-error': urlError }"
          v-model="rawUrl"
          :readonly="isViewingMode"
          @input="commandError = ''"
          @keydown.enter.stop.prevent="handleSubmit"
          @keydown="urlError = false"
        />

        <div
          class="open-link-icon"
          :class="{ 'sd-disabled': !validUrl }"
          v-html="toolbarIcons.openLink"
          @click="openLink"
          data-item="btn-link-open"
        ></div>
      </div>
      <div class="input-row link-buttons" v-if="!isViewingMode">
        <button
          class="remove-btn"
          @click="handleRemove"
          :disabled="isSubmitting"
          v-if="isEditing"
          data-item="btn-link-remove"
        >
          <div class="remove-btn__icon" v-html="toolbarIcons.removeLink"></div>
          Remove
        </button>
        <button
          class="sd-submit-btn"
          @click="handleSubmit"
          :class="{ 'disable-btn': isDisabled }"
          :disabled="isSubmitting"
          data-item="btn-link-apply"
        >
          Apply
        </button>
      </div>
      <div v-if="commandError" role="alert" class="sd-error">{{ commandError }}</div>
    </div>

    <div v-else-if="isAnchor" class="input-row go-to-anchor clickable">
      <a @click.stop.prevent="navigateToAnchor(rawUrl)"
        >Go to {{ rawUrl.startsWith('#_') ? rawUrl.substring(2) : rawUrl }}</a
      >
    </div>
    <div v-if="navigationError" role="status" class="sd-error">{{ navigationError }}</div>
  </div>
</template>

<style scoped>
.link-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.link-input-ctn {
  width: 320px;
  display: flex;
  flex-direction: column;
  padding: 1em;
  border-radius: var(--sd-ui-radius, 6px);
  background-color: var(--sd-ui-dropdown-bg, #ffffff);
  box-sizing: border-box;

  :deep(svg) {
    width: 100%;
    height: 100%;
    display: block;
    fill: currentColor;
  }

  .input-row {
    align-content: baseline;
    display: flex;
    align-items: center;
    position: relative;
    font-size: var(--sd-ui-font-size-600, 16px);

    input {
      font-size: var(--sd-ui-font-size-300, 13px);
      flex-grow: 1;
      min-width: 0;
      padding: 10px;
      border-radius: var(--sd-ui-radius, 6px);
      padding-left: 34px;
      box-shadow: var(--sd-ui-shadow, 0 4px 12px rgba(0, 0, 0, 0.12));
      color: var(--sd-ui-text-muted, #666666);
      border: 1px solid var(--sd-ui-border, #dbdbdb);
      box-sizing: border-box;

      &:active,
      &:focus {
        outline: none;
        border: 1px solid var(--sd-ui-action, #1355ff);
      }

      &[readonly] {
        background-color: var(--sd-ui-disabled-bg, #f5f5f5);
        cursor: default;
        color: var(--sd-ui-text-disabled, #888);
        border-color: var(--sd-ui-border, #e0e0e0);

        &:active,
        &:focus {
          border-color: var(--sd-ui-border, #e0e0e0);
        }
      }
    }
  }

  .input-icon {
    position: absolute;
    left: 12px;
    width: 14px;
    color: var(--sd-ui-text-disabled, #ababab);
    pointer-events: none;
    text-align: center;
    z-index: 1;
  }

  .input-icon:not(.text-input-icon) {
    transform: rotate(45deg);
    height: 14px;
  }

  &.high-contrast {
    .input-icon {
      color: var(--sd-ui-text, #47484a);
    }

    .input-row input {
      color: var(--sd-ui-text, #47484a);
      border-color: var(--sd-ui-text, #47484a);
    }
  }
}
.open-link-icon {
  margin-left: 10px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid transparent;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  transition: all 0.2s ease;
  cursor: pointer;
}

.open-link-icon:hover {
  color: var(--sd-ui-action, #1355ff);
  background-color: var(--sd-ui-bg, #ffffff);
  border: 1px solid var(--sd-ui-border, #dbdbdb);
}

.open-link-icon :deep(svg) {
  width: 15px;
  height: 15px;
}

.sd-disabled {
  opacity: 0.6;
  cursor: not-allowed;
  pointer-events: none;
}

.link-buttons {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.remove-btn__icon {
  display: inline-flex;
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  margin-right: 4px;
}

.link-buttons button {
  margin-left: 5px;
}

.disable-btn {
  opacity: 0.6;
  cursor: not-allowed;
  pointer-events: none;
}

.go-to-anchor a {
  font-size: var(--sd-ui-font-size-400, 14px);
  text-decoration: underline;
}

.clickable {
  cursor: pointer;
}

.link-title {
  font-size: var(--sd-ui-font-size-400, 14px);
  font-weight: 600;
  color: var(--sd-ui-text, #47484a);
  margin-bottom: 10px;
}

.hasBottomMargin {
  margin-bottom: 1em;
}

.remove-btn {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  padding: 10px 16px;
  border-radius: var(--sd-ui-radius, 6px);
  outline: none;
  background-color: var(--sd-ui-bg, #ffffff);
  color: var(--sd-ui-text, #47484a);
  font-weight: 400;
  font-size: var(--sd-ui-font-size-300, 13px);
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  box-sizing: border-box;
}

.remove-btn:hover {
  background-color: var(--sd-ui-hover-bg, #dbdbdb);
}

.sd-submit-btn {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  padding: 10px 16px;
  border-radius: var(--sd-ui-radius, 6px);
  outline: none;
  border: none;
  background-color: var(--sd-ui-action, #1355ff);
  color: var(--sd-ui-action-text, #ffffff);
  font-weight: 400;
  font-size: var(--sd-ui-font-size-300, 13px);
  cursor: pointer;
  transition: all 0.2s ease;
  box-sizing: border-box;
  &:hover {
    background-color: var(--sd-ui-action-hover, #0f44cc);
  }
}

.sd-error {
  border-color: red !important;
  background-color: #ff00001a;
}
</style>
