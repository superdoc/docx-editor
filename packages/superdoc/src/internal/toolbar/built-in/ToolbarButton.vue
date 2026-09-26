<script setup>
import ToolbarButtonIcon from './ToolbarButtonIcon.vue';
import { ref, computed, nextTick, watch, getCurrentInstance } from 'vue';
import { toolbarIcons } from './toolbarIcons.js';
import { useHighContrastMode } from '../../../composables/use-high-contrast-mode';
const emit = defineEmits(['buttonClick', 'textSubmit', 'mainClick']);
const { proxy } = getCurrentInstance();

const props = defineProps({
  iconColor: {
    type: String,
    default: null,
  },
  active: {
    type: Boolean,
    default: false,
  },
  isNarrow: {
    type: Boolean,
    default: false,
  },
  isWide: {
    type: Boolean,
    default: false,
  },
  toolbarItem: {
    type: Object,
    required: true,
  },
  defaultLabel: {
    type: String,
    default: null,
  },
  isOverflowItem: {
    type: Boolean,
    default: false,
  },
  // When true, Enter does not stopPropagation at this button - the event
  // bubbles up to whatever parent listens for keyboard activation (e.g.
  // ButtonGroup's roving-tabindex handler when this button is the visual
  // trigger inside a ToolbarDropdown). Plain-button uses keep the default
  // (false) so the parent does not double-fire the command emission.
  // Note: split buttons stop propagation internally inside
  // handleSplitMainClick, so this prop has no effect for them - Enter still
  // runs the main command on a split button regardless.
  allowEnterPropagation: {
    type: Boolean,
    default: false,
  },
});

const {
  name,
  active,
  icon,
  label,
  hideLabel,
  iconColor,
  hasCaret,
  splitButton,
  disabled,
  expand,
  inlineTextInputVisible,
  hasInlineTextInput,
  minWidth,
  style,
  attributes,
} = props.toolbarItem;

const isSplit = computed(() => Boolean(splitButton?.value) && Boolean(hasCaret?.value));
const itemName = computed(() => name?.value ?? '');

const inlineTextInput = ref('');
const inlineInput = ref(null);
const { isHighContrastMode } = useHighContrastMode();

watch(
  () => label?.value,
  (next) => {
    if (document.activeElement === inlineInput.value) return;
    inlineTextInput.value = next == null ? '' : String(next);
  },
  { immediate: true },
);

const handleClick = () => {
  if (hasInlineTextInput) {
    nextTick(() => {
      inlineInput.value?.focus();
      inlineInput.value?.select();
    });
  }
  emit('buttonClick');
};

const handleSplitMainClick = (event) => {
  if (disabled?.value) return;
  event?.stopPropagation();
  emit('mainClick');
};

const handleOuterClick = () => {
  if (isSplit.value) return;
  handleClick();
};

const handleOuterEnter = (event) => {
  if (isSplit.value) {
    handleSplitMainClick(event);
    return;
  }
  handleClick();
};

const onEnterKeydown = (event) => {
  // Opening a dialog can focus a native button before Enter's default action runs.
  event.preventDefault();
  if (!props.allowEnterPropagation) event.stopPropagation();
  handleOuterEnter(event);
};

const resolveFontFamilyInput = (rawValue) => {
  const options = props.toolbarItem?.nestedOptions?.value ?? [];
  const normalized = rawValue.trim();
  if (!normalized) return '';
  const exact = options.find(
    (option) => typeof option?.label === 'string' && option.label.toLowerCase() === normalized.toLowerCase(),
  );
  if (exact?.label) return exact.label;
  const prefix = options.find(
    (option) => typeof option?.label === 'string' && option.label.toLowerCase().startsWith(normalized.toLowerCase()),
  );
  return prefix?.label ?? normalized;
};

const handleInputSubmit = () => {
  const value = String(inlineTextInput.value ?? '').trim();
  let cleanValue = value;
  if (itemName.value === 'fontSize') {
    const parsed = Number.parseFloat(value);
    cleanValue = value.match(/^\d+(\.5)?$/) ? value : Number.isFinite(parsed) ? Math.floor(parsed).toString() : '';
  } else if (itemName.value === 'fontFamily') {
    cleanValue = resolveFontFamilyInput(value);
  }
  if (!cleanValue) return false;
  emit('textSubmit', cleanValue);
  inlineTextInput.value = cleanValue;
  return true;
};

const selectInlineInputContents = (event) => {
  const input = event?.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  input.focus({ preventScroll: true });
  input.select();
};

const focusInlineInput = (name) => {
  requestAnimationFrame(() => {
    const input = document.getElementById(`inlineTextInput-${name}`);
    if (!(input instanceof HTMLInputElement)) return;
    input.focus({ preventScroll: true });
    input.select();
  });
};

const focusEditorElement = () => {
  const editor = document.querySelector('[role="textbox"][aria-label*="SuperDoc body"], .ProseMirror');
  if (!(editor instanceof HTMLElement)) return false;
  editor.focus({ preventScroll: true });
  return true;
};

const focusEditorSurface = () => {
  const capture = proxy?.$toolbar?.pendingSelectionCapture;
  const restoreSelection = () => {
    if (capture && typeof proxy?.$toolbar?.ui?.selection?.restore === 'function') {
      proxy.$toolbar.ui.selection.restore(capture);
    }
  };
  if (focusEditorElement()) {
    restoreSelection();
    return;
  }
  if (typeof proxy?.$toolbar?.superdoc?.focus === 'function') {
    proxy.$toolbar.superdoc.focus();
    restoreSelection();
  }
};

const handleInlineInputEnter = () => {
  const applied = handleInputSubmit();
  if (!applied) return;
  focusEditorSurface();
};

const handleInlineInputTab = (event) => {
  handleInputSubmit();

  if (event.shiftKey) {
    // Word-style reverse chain: Shift+Tab from the font-size field returns to the
    // font-family control. Other inline inputs keep the browser default.
    if (itemName.value === 'fontSize') {
      event.preventDefault();
      nextTick(() => focusInlineInput('fontFamily'));
    }
    return;
  }

  event.preventDefault();

  if (itemName.value === 'fontFamily') {
    nextTick(() => focusInlineInput('fontSize'));
    return;
  }

  if (itemName.value === 'fontSize') {
    nextTick(focusEditorSurface);
  }
};

const getStyle = computed(() => {
  if (style.value) return style.value;
  return {
    minWidth: props.minWidth,
  };
});

const onFontSizeInput = (event) => {
  let { value } = event.target;
  inlineTextInput.value = value.replace(/[^0-9]/g, '');
};

const caretIcon = computed(() => {
  return expand?.value ? toolbarIcons.dropdownCaretUp : toolbarIcons.dropdownCaretDown;
});
</script>

<template>
  <div
    :class="['sd-toolbar-item', attributes.className]"
    :style="getStyle"
    :role="isOverflowItem ? 'menuitem' : 'button'"
    :aria-label="attributes.ariaLabel"
    :aria-disabled="disabled ? 'true' : undefined"
    data-sd-part="toolbar-item"
    @click="handleOuterClick"
    @keydown.enter="onEnterKeydown($event)"
    tabindex="0"
  >
    <div
      class="sd-toolbar-button"
      :class="{
        'sd-active': active,
        'sd-disabled': disabled,
        narrow: isNarrow,
        wide: isWide,
        split: isSplit,
        'has-inline-text-input': hasInlineTextInput,
        'high-contrast': isHighContrastMode,
      }"
      :data-item="`btn-${name || ''}`"
    >
      <div
        v-if="isSplit"
        class="sd-toolbar-button__main"
        :data-item="`btn-${name || ''}-main`"
        @click="handleSplitMainClick($event)"
      >
        <ToolbarButtonIcon v-if="icon" :color="iconColor" class="sd-toolbar-icon" :icon="icon" :name="name">
        </ToolbarButtonIcon>
        <div class="sd-button-label" v-if="label && !hideLabel && !inlineTextInputVisible">
          {{ label }}
        </div>
      </div>
      <div
        v-if="isSplit"
        class="sd-toolbar-button__caret"
        :data-item="`btn-${name || ''}-caret`"
        :aria-label="`${attributes.ariaLabel} options`"
        role="button"
      >
        <div class="sd-dropdown-caret" v-html="caretIcon" :style="{ opacity: disabled ? 0.6 : 1 }"></div>
      </div>

      <template v-else>
        <ToolbarButtonIcon v-if="icon" :color="iconColor" class="sd-toolbar-icon" :icon="icon" :name="name">
        </ToolbarButtonIcon>

        <div
          class="sd-button-label"
          :class="{ 'sd-visually-hidden': inlineTextInputVisible && itemName === 'fontFamily' }"
          v-if="label && !hideLabel && (!inlineTextInputVisible || itemName === 'fontFamily')"
        >
          {{ label }}
        </div>

        <span v-if="inlineTextInputVisible">
          <input
            v-if="name === 'fontSize'"
            v-model="inlineTextInput"
            @keydown.enter.stop.prevent="handleInlineInputEnter"
            @keydown.tab="handleInlineInputTab($event)"
            @click.stop="selectInlineInputContents($event)"
            @focus="selectInlineInputContents($event)"
            type="text"
            class="button-text-input button-text-input--font-size"
            :class="{ 'high-contrast': isHighContrastMode }"
            :id="'inlineTextInput-' + name"
            autocomplete="off"
            ref="inlineInput"
          />
          <input
            v-else
            v-model="inlineTextInput"
            :placeholder="label"
            @keydown.enter.stop.prevent="handleInlineInputEnter"
            @keydown.tab="handleInlineInputTab($event)"
            @click.stop="selectInlineInputContents($event)"
            @focus="selectInlineInputContents($event)"
            type="text"
            class="button-text-input"
            :class="{
              'button-text-input--font-family': itemName === 'fontFamily',
              'high-contrast': isHighContrastMode,
            }"
            :id="'inlineTextInput-' + name"
            :data-item="itemName === 'fontFamily' ? `btn-${name}-input` : undefined"
            autocomplete="off"
            ref="inlineInput"
          />
        </span>

        <div
          v-if="hasCaret"
          class="sd-dropdown-caret"
          :data-item="`btn-${name || ''}-toggle`"
          v-html="caretIcon"
          :style="{ opacity: disabled ? 0.6 : 1 }"
        ></div>
      </template>

      <div aria-live="polite" class="sd-visually-hidden">
        {{ `${attributes.ariaLabel} ${active ? 'selected' : 'unset'}` }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.sd-toolbar-item {
  position: relative;
  z-index: 1;
  min-width: 30px;
  margin: 0 calc(var(--sd-ui-toolbar-item-gap, 2px) / 2);
}

.sd-visually-hidden {
  position: absolute;
  left: -9999px;
  height: 1px;
  width: 1px;
  overflow: hidden;
}

.sd-toolbar-button {
  padding: var(--sd-ui-toolbar-item-padding, 5px);
  height: var(--sd-ui-toolbar-height, 32px);
  max-height: var(--sd-ui-toolbar-height, 32px);
  border-radius: var(--sd-ui-radius, 6px);
  overflow-y: visible;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--sd-ui-toolbar-button-text, #47484a);
  transition: all 0.2s ease-out;
  user-select: none;
  position: relative;
  box-sizing: border-box;
}

.sd-toolbar-button:hover {
  background-color: var(--sd-ui-toolbar-button-hover-bg, var(--sd-ui-hover-bg, #dbdbdb));

  .sd-toolbar-icon {
    &.high-contrast {
      color: #fff;
    }
  }

  &.high-contrast {
    background-color: #000;
    color: #fff;
  }
}

.sd-toolbar-button:active,
.sd-active {
  background-color: var(--sd-ui-toolbar-button-active-bg, var(--sd-ui-active-bg, #c8d0d8));
}

.sd-button-label {
  overflow: hidden;
  width: 100%;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  font-size: var(--sd-ui-font-size-500, 15px);
  margin: 5px;
}

.sd-toolbar-icon + .sd-dropdown-caret {
  margin-left: 4px;
}

.sd-toolbar-button.split {
  padding: 0;
  gap: 0;
}

.sd-toolbar-button.split .sd-toolbar-button__main,
.sd-toolbar-button.split .sd-toolbar-button__caret {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  box-sizing: border-box;
  position: relative;
  z-index: 1;
}

.sd-toolbar-button.split .sd-toolbar-button__main {
  padding: 0 3px 0 var(--sd-ui-toolbar-item-padding, 5px);
  border-top-left-radius: var(--sd-ui-radius, 6px);
  border-bottom-left-radius: var(--sd-ui-radius, 6px);
}

.sd-toolbar-button.split .sd-toolbar-button__caret {
  padding: 0 4px 0 2px;
  border-top-right-radius: var(--sd-ui-radius, 6px);
  border-bottom-right-radius: var(--sd-ui-radius, 6px);
}

/* Unified hover: hovering anywhere on the split button highlights the whole
   button so it reads as a single grouped item, with a slightly darker tint
   on the half the cursor is actually over. */
.sd-toolbar-button.split:hover {
  background-color: var(--sd-ui-toolbar-button-hover-bg, var(--sd-ui-hover-bg, #dbdbdb));
}

.sd-toolbar-button.split .sd-toolbar-button__main:hover,
.sd-toolbar-button.split .sd-toolbar-button__caret:hover {
  background-color: var(--sd-ui-toolbar-button-active-bg, var(--sd-ui-active-bg, #c8d0d8));
}

/* Subtle divider only appears on hover, hinting at the two affordances
   without making them look like separate buttons at rest. */
.sd-toolbar-button.split .sd-toolbar-button__caret::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 1px;
  background-color: transparent;
  transition: background-color 0.15s ease-out;
}

.sd-toolbar-button.split:hover .sd-toolbar-button__caret::before {
  background-color: var(--sd-ui-border, rgba(71, 72, 74, 0.2));
}

.sd-toolbar-button.split.sd-disabled,
.sd-toolbar-button.split.sd-disabled:hover {
  background-color: initial;
}

.sd-toolbar-button.split.sd-disabled .sd-toolbar-button__main,
.sd-toolbar-button.split.sd-disabled .sd-toolbar-button__caret {
  cursor: default;
}

.sd-toolbar-button.split.sd-disabled .sd-toolbar-button__main:hover,
.sd-toolbar-button.split.sd-disabled .sd-toolbar-button__caret:hover {
  background-color: initial;
}

.sd-toolbar-button.split.sd-disabled .sd-toolbar-button__caret::before {
  background-color: transparent;
}

.left,
.right {
  width: 50%;
  height: 100%;
  background-color: #dbdbdb;
  border-radius: 60%;
}

.has-inline-text-input:hover {
  cursor: text;
}

.sd-disabled {
  cursor: default;
}

.sd-disabled:hover {
  cursor: default;
  background-color: initial;
}

.sd-disabled .sd-toolbar-icon,
.sd-disabled .sd-button-label {
  opacity: 0.35;
}

.button-text-input {
  color: var(--sd-ui-toolbar-button-text, #47484a);
  border-radius: 4px;
  text-align: center;
  width: 30px;
  font-size: var(--sd-ui-font-size-400, 14px);
  margin-right: 5px;
  font-weight: 400;
  background-color: transparent;
  padding: 2px 0;
  outline: none;
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  box-sizing: border-box;

  &.high-contrast {
    background-color: #fff;
  }
}

.button-text-input--font-size {
  width: 36px;
}

.button-text-input--font-family {
  width: 88px;
}

.button-text-input::placeholder {
  color: var(--sd-ui-toolbar-button-text, #47484a);
}

.sd-dropdown-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: auto;
  width: 10px;
  height: 10px;
}

.sd-toolbar-item--doc-mode-compact .sd-button-label {
  display: none;
}

.sd-toolbar-item--doc-mode-compact .sd-toolbar-icon {
  margin-right: 5px;
}

.sd-toolbar-item--linked-styles-compact {
  width: auto !important;
}

.sd-toolbar-item--linked-styles-compact .sd-button-label {
  display: none;
}
</style>
