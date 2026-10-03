<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { toolbarIcons } from './toolbarIcons.js';
import { useHighContrastMode } from '../../../composables/use-high-contrast-mode';
import { computeTypeahead, findPrefixMatchIndex } from './font-typeahead.js';

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  uiFontFamily: {
    type: String,
    default: 'Arial, Helvetica, sans-serif',
  },
  // Font family previews each option/input in its own typeface; font size renders
  // in the UI font, so the size control passes showPreview=false.
  showPreview: {
    type: Boolean,
    default: false,
  },
  // Normalizes a typed value that matches no preset before it is applied as a
  // custom command argument (family: logical family string; size: clamped int).
  normalizeValue: {
    type: Function,
    default: (value) => String(value ?? '').trim(),
  },
});

const emit = defineEmits(['command', 'item-clicked', 'tab-out', 'editor-handoff']);

const { isHighContrastMode } = useHighContrastMode();

const inputRef = ref(null);
const rootRef = ref(null);
const popupRef = ref(null);
const optionRefs = ref([]);

const isEditing = ref(false);
const isOpen = ref(false);
const activeIndex = ref(-1);
const query = ref('');
const inputDisplay = ref('');
const isComposing = ref(false);
const menuPosition = ref({ top: '0px', left: '0px', minWidth: '0px', maxHeight: 'none' });

const options = computed(() => props.item.nestedOptions?.value ?? []);
const optionLabels = computed(() => options.value.map((option) => String(option?.label ?? '')));
const appliedLabel = computed(() => String(props.item.label?.value ?? ''));
const disabled = computed(() => Boolean(props.item.disabled?.value));
const itemName = computed(() => String(props.item.name?.value ?? ''));
const ariaLabel = computed(() => props.item.attributes?.value?.ariaLabel ?? 'Font family');

const boundValue = computed(() => (isEditing.value ? inputDisplay.value : appliedLabel.value));

const listboxId = computed(() => `sd-${itemName.value || 'combobox'}-listbox-${props.item.id?.value ?? 'default'}`);
const optionId = (index) => `${listboxId.value}-option-${index}`;
const activeDescendant = computed(() =>
  isOpen.value && activeIndex.value >= 0 ? optionId(activeIndex.value) : undefined,
);

const caretIcon = computed(() => (isOpen.value ? toolbarIcons.dropdownCaretUp : toolbarIcons.dropdownCaretDown));

const previewFamilyForLabel = (label) => {
  const normalized = String(label ?? '')
    .trim()
    .toLowerCase();
  const option = options.value.find(
    (candidate) =>
      String(candidate?.label ?? '')
        .trim()
        .toLowerCase() === normalized,
  );
  return option?.props?.style?.fontFamily || label || props.uiFontFamily;
};

const inputStyle = computed(() => {
  if (!props.showPreview) return { fontFamily: props.uiFontFamily };
  return { fontFamily: previewFamilyForLabel(isEditing.value ? inputDisplay.value : appliedLabel.value) };
});

const appliedIndex = () => {
  const selectedKey = props.item.selectedValue?.value;
  if (selectedKey) {
    const byKey = options.value.findIndex((option) => option?.key === selectedKey);
    if (byKey >= 0) return byKey;
  }
  const byLabel = optionLabels.value.findIndex((label) => label.toLowerCase() === appliedLabel.value.toLowerCase());
  return byLabel;
};

const setSelectionRange = (start, end) => {
  const el = inputRef.value;
  if (!el || typeof el.setSelectionRange !== 'function') return;
  try {
    el.setSelectionRange(start, end);
  } catch {
    // Ignore inputs that do not support selection ranges.
  }
};

const scrollActiveIntoView = () => {
  const el = optionRefs.value[activeIndex.value];
  el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
};

const focusActiveOption = () => {
  optionRefs.value[activeIndex.value]?.focus?.();
};

const updatePosition = () => {
  const trigger = rootRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const menuEl = popupRef.value;
  const menuHeight = menuEl?.scrollHeight ?? menuEl?.offsetHeight ?? 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const gutter = 8;
  const gap = 4;
  const belowTop = rect.bottom + gap;
  const aboveBottom = rect.top - gap;
  const availableBelow = Math.max(0, viewportHeight - belowTop - gutter);
  const availableAbove = Math.max(0, aboveBottom - gutter);
  const openAbove = availableBelow < menuHeight && availableAbove > availableBelow;
  const maxHeight = openAbove ? availableAbove : availableBelow;
  const renderHeight = menuHeight ? Math.min(menuHeight, maxHeight) : maxHeight;
  const top = openAbove ? Math.max(gutter, aboveBottom - renderHeight) : belowTop;
  const left = Math.min(Math.max(gutter, rect.left), Math.max(gutter, viewportWidth - rect.width - gutter));

  menuPosition.value = {
    top: `${top}px`,
    left: `${left}px`,
    minWidth: `${rect.width}px`,
    maxHeight: `${maxHeight}px`,
  };
};

const menuStyle = computed(() => ({
  position: 'fixed',
  top: menuPosition.value.top,
  left: menuPosition.value.left,
  minWidth: menuPosition.value.minWidth,
  maxHeight: menuPosition.value.maxHeight,
  fontFamily: props.uiFontFamily,
  zIndex: 2000,
}));

const setItemExpanded = (open) => {
  if (props.item.expand && typeof props.item.expand === 'object' && 'value' in props.item.expand) {
    props.item.expand.value = open;
  }
};

const openList = (index, { focusInput = false, focusOption = false } = {}) => {
  if (disabled.value || !options.value.length) {
    setItemExpanded(false);
    return;
  }
  isOpen.value = true;
  setItemExpanded(true);
  activeIndex.value = index ?? -1;
  if (focusInput) {
    isEditing.value = true;
    inputDisplay.value = appliedLabel.value;
    inputRef.value?.focus();
  }
  nextTick(() => {
    updatePosition();
    scrollActiveIntoView();
    // Chevron/ArrowDown opens move keyboard focus onto the active option so the
    // list drives Arrow navigation directly. The onBlur popup guard keeps the
    // resulting input blur from resetting the field.
    if (focusOption) focusActiveOption();
  });
};

const closeList = ({ syncItem = true } = {}) => {
  isOpen.value = false;
  activeIndex.value = -1;
  if (syncItem) setItemExpanded(false);
};

const resetToApplied = () => {
  closeList();
  isEditing.value = false;
  query.value = '';
  inputDisplay.value = appliedLabel.value;
};

const onFocus = () => {
  if (disabled.value) return;
  // Focus landing on the input as part of a programmatic open (openList sets isOpen first,
  // then focuses) must not emit item-clicked: the parent reads that as "close open dropdowns"
  // and would immediately close this combobox mid-open during keyboard/roving navigation.
  if (!isOpen.value) emit('item-clicked');
  isEditing.value = true;
  query.value = '';
  inputDisplay.value = appliedLabel.value;
  nextTick(() => setSelectionRange(0, inputDisplay.value.length));
};

const onInputMousedown = (event) => {
  if (disabled.value) return;

  const hadInputFocus = document.activeElement === inputRef.value;
  emit('item-clicked');
  isEditing.value = true;

  if (!hadInputFocus) {
    query.value = '';
    inputDisplay.value = appliedLabel.value;
    event.preventDefault();
    inputRef.value?.focus({ preventScroll: true });
    setSelectionRange(0, appliedLabel.value.length);
  }

  // Open the list on a click anywhere in the field, not just the chevron
  // (SD-3652 / parity with v1 SD-3453), landing on the applied value.
  if (!isOpen.value) {
    const index = appliedIndex();
    openList(index >= 0 ? index : 0);
  }
};

const onBlur = (event) => {
  const next = event.relatedTarget;
  if (next instanceof Node && rootRef.value?.contains(next)) return;
  if (next instanceof Node && popupRef.value?.contains(next)) return;
  resetToApplied();
};

const onInput = (event) => {
  if (isComposing.value) return;
  const el = event.target;
  const typed = el.value;
  const selectionStart = typeof el.selectionStart === 'number' ? el.selectionStart : typed.length;
  const selectionEnd = typeof el.selectionEnd === 'number' ? el.selectionEnd : selectionStart;
  const isDelete = typeof event.inputType === 'string' && event.inputType.startsWith('delete');
  const editAtEnd = selectionStart === typed.length && selectionEnd === typed.length;
  query.value = typed;
  const result = computeTypeahead(typed, optionLabels.value, { autocomplete: !isDelete && editAtEnd });
  // Drive the value imperatively: the autocompleted string can be identical across
  // keystrokes (typing "A" then "r" both complete to "Arial"), so a one-way :value
  // binding would not re-patch the DOM and the completion would be lost.
  inputDisplay.value = result.display;
  el.value = result.display;
  if (result.display === typed && !editAtEnd) {
    setSelectionRange(selectionStart, selectionEnd);
  } else {
    setSelectionRange(result.selectionStart, result.selectionEnd);
  }
  if (isOpen.value) {
    activeIndex.value = result.matchIndex;
    nextTick(scrollActiveIntoView);
  }
};

const onCompositionEnd = (event) => {
  isComposing.value = false;
  onInput(event);
};

const moveActive = (direction) => {
  if (!options.value.length) return;
  const count = options.value.length;
  const start = activeIndex.value < 0 ? (direction > 0 ? -1 : 0) : activeIndex.value;
  activeIndex.value = (start + direction + count) % count;
  nextTick(scrollActiveIntoView);
};

const emitFontCommand = (label, option) => {
  emit('item-clicked');
  emit('command', { item: props.item, argument: label, option });
  if (option) props.item.selectedValue.value = option.key;
};

const applyOption = (option) => {
  if (!option) return;
  emitFontCommand(option.value ?? option.label, option);
  isEditing.value = false;
  query.value = '';
  inputDisplay.value = option.label;
  closeList();
};

const applySelection = () => {
  if (isOpen.value && activeIndex.value >= 0) {
    applyOption(options.value[activeIndex.value]);
    return true;
  }
  const matchIndex = findPrefixMatchIndex(query.value, optionLabels.value);
  if (matchIndex >= 0) {
    applyOption(options.value[matchIndex]);
    return true;
  }
  const custom = props.normalizeValue(query.value);
  if (custom) {
    emitFontCommand(custom, null);
    isEditing.value = false;
    query.value = '';
    inputDisplay.value = custom;
    closeList();
    return true;
  }
  return false;
};

const onKeydown = (event) => {
  if (event.isComposing || isComposing.value || event.keyCode === 229) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (!isOpen.value) {
        const typedMatch = findPrefixMatchIndex(query.value, optionLabels.value);
        const index = typedMatch >= 0 ? typedMatch : appliedIndex();
        openList(index >= 0 ? index : 0, { focusOption: true });
      } else {
        focusActiveOption();
      }
      break;
    case 'ArrowUp':
      event.preventDefault();
      if (!isOpen.value) {
        const typedMatch = findPrefixMatchIndex(query.value, optionLabels.value);
        const index = typedMatch >= 0 ? typedMatch : appliedIndex();
        openList(index >= 0 ? index : options.value.length - 1, { focusOption: true });
      } else {
        focusActiveOption();
      }
      break;
    case 'Enter':
      event.preventDefault();
      if (applySelection()) emit('editor-handoff');
      inputRef.value?.blur();
      break;
    case 'Tab':
      event.preventDefault();
      applySelection();
      closeList();
      inputRef.value?.blur();
      emit('tab-out', event);
      break;
    case 'Escape':
      event.preventDefault();
      resetToApplied();
      nextTick(() => inputRef.value?.focus());
      break;
    default:
      break;
  }
};

const onCaretMousedown = (event) => {
  // Prevent the mousedown from focusing the caret button so focus can be placed
  // deliberately: into the open list when opening, back on the input when closing.
  event.preventDefault();
  if (disabled.value) return;
  emit('item-clicked');
  if (isOpen.value) {
    closeList();
    inputRef.value?.focus();
  } else {
    const index = appliedIndex();
    openList(index >= 0 ? index : 0, { focusOption: true });
  }
};

const onOptionMousedown = (event, option) => {
  // Prevent the input from blurring mid-apply so the restored selection holds,
  // then settle focus so the field returns to its non-editing applied state.
  event.preventDefault();
  applyOption(option);
  emit('editor-handoff');
  inputRef.value?.blur();
};

const onOptionMouseenter = (index) => {
  activeIndex.value = index;
};

const onOptionKeydown = (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      moveActive(1);
      focusActiveOption();
      break;
    case 'ArrowUp':
      event.preventDefault();
      moveActive(-1);
      focusActiveOption();
      break;
    case 'Enter':
      event.preventDefault();
      if (activeIndex.value >= 0) {
        applyOption(options.value[activeIndex.value]);
        emit('editor-handoff');
      }
      break;
    case 'Escape':
      event.preventDefault();
      resetToApplied();
      nextTick(() => inputRef.value?.focus());
      break;
    case 'Tab':
      // Forward an input-anchored event so the parent's Word Tab chain lands on
      // the adjacent toolbar control; the focused option is teleported outside
      // the toolbar item, so its own target would hand off to the editor instead.
      event.preventDefault();
      if (activeIndex.value >= 0) {
        applyOption(options.value[activeIndex.value]);
      } else {
        closeList();
      }
      emit('tab-out', { shiftKey: event.shiftKey, target: inputRef.value });
      break;
    default:
      break;
  }
};

const handleDocumentPointerDown = (event) => {
  if (!isOpen.value) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (rootRef.value?.contains(target) || popupRef.value?.contains(target)) return;
  // Focus may sit on an option (outside the input), so onBlur will not fire to
  // discard an in-progress edit; reset explicitly on outside dismissal.
  resetToApplied();
};

watch(
  isOpen,
  (open) => {
    if (open) {
      document.addEventListener('pointerdown', handleDocumentPointerDown, true);
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
    } else {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      optionRefs.value = [];
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', updatePosition, true);
});

const setOptionRef = (el, index) => {
  if (!el) {
    delete optionRefs.value[index];
    return;
  }
  optionRefs.value[index] = el;
};

const isOptionActive = (index) => index === activeIndex.value;
const isOptionSelected = (option) => option?.key && option.key === props.item.selectedValue?.value;

watch(appliedLabel, (label) => {
  if (isEditing.value) return;
  inputDisplay.value = label;
});

watch(
  () => Boolean(props.item.expand?.value),
  (expanded) => {
    if (expanded && !isOpen.value) {
      const index = appliedIndex();
      openList(index >= 0 ? index : 0, { focusInput: true });
      return;
    }
    if (!expanded && isOpen.value) {
      closeList({ syncItem: false });
    }
  },
);
</script>

<template>
  <div
    ref="rootRef"
    class="sd-font-combobox sd-toolbar-split-field"
    :class="{ 'sd-disabled': disabled, 'high-contrast': isHighContrastMode }"
    :style="props.item.style?.value"
    :data-item="`btn-${itemName}`"
  >
    <span class="sd-font-combobox__field sd-toolbar-split-field__main" @mousedown="onInputMousedown">
      <input
        ref="inputRef"
        :id="`inlineTextInput-${itemName}`"
        class="button-text-input sd-font-combobox__input"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        :value="boundValue"
        :style="inputStyle"
        :disabled="disabled"
        :aria-label="ariaLabel"
        :aria-expanded="isOpen ? 'true' : 'false'"
        :aria-controls="listboxId"
        :aria-activedescendant="activeDescendant"
        aria-haspopup="listbox"
        aria-autocomplete="both"
        :data-item="`btn-${itemName}-input`"
        @focus="onFocus"
        @blur="onBlur"
        @input="onInput"
        @keydown="onKeydown"
        @compositionstart="isComposing = true"
        @compositionend="onCompositionEnd"
      />
    </span>
    <button
      type="button"
      class="sd-font-combobox__caret sd-toolbar-split-field__caret"
      :data-item="`btn-${itemName}-toggle`"
      tabindex="-1"
      :aria-label="`${ariaLabel} options`"
      :disabled="disabled"
      @mousedown="onCaretMousedown"
    >
      <span class="sd-dropdown-caret" v-html="caretIcon"></span>
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="popupRef"
        role="listbox"
        data-sd-part="dropdown-menu"
        :id="listboxId"
        :aria-label="ariaLabel"
        class="sd-font-combobox__listbox"
        :class="{ 'high-contrast': isHighContrastMode }"
        :style="menuStyle"
      >
        <div
          v-for="(option, index) in options"
          :key="option.key"
          :ref="(el) => setOptionRef(el, index)"
          :id="optionId(index)"
          role="option"
          tabindex="-1"
          class="toolbar-dropdown-option sd-font-combobox__option"
          :class="{ 'sd-active': isOptionActive(index), 'sd-selected': isOptionSelected(option) }"
          :aria-selected="isOptionSelected(option) ? 'true' : 'false'"
          :aria-label="`${ariaLabel} - ${option.label}`"
          v-bind="option.props"
          @mousedown="(e) => onOptionMousedown(e, option)"
          @mouseenter="onOptionMouseenter(index)"
          @keydown="onOptionKeydown"
        >
          <span class="toolbar-dropdown-option__label">{{ option.label }}</span>
        </div>
      </div>
    </Teleport>
    <span class="sd-button-label sd-font-combobox__legacy-label" aria-hidden="true">{{ appliedLabel }}</span>
  </div>
</template>

<style scoped>
.sd-font-combobox {
  display: inline-flex;
  align-items: center;
  height: var(--sd-ui-toolbar-height, 32px);
  max-height: var(--sd-ui-toolbar-height, 32px);
  padding: 0;
  border-radius: var(--sd-ui-radius, 6px);
  box-sizing: border-box;
  cursor: text;
  color: var(--sd-ui-toolbar-button-text, #47484a);
  transition: background-color 0.2s ease-out;
  position: relative;
}

.sd-font-combobox:focus-within {
  background-color: var(--sd-ui-toolbar-button-active-bg, var(--sd-ui-active-bg, #c8d0d8));
}

.sd-font-combobox.high-contrast:focus-within {
  background-color: #000;
  color: #fff;
}

.sd-font-combobox.sd-disabled {
  cursor: default;
  opacity: 0.35;
}

.sd-font-combobox__field {
  flex: 1 1 auto;
  min-width: 0;
}

.sd-font-combobox__input {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0 4px 0 8px;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: var(--sd-ui-font-size-500, 15px);
  font-weight: 400;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

.sd-font-combobox__legacy-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.sd-font-combobox__caret {
  flex-shrink: 0;
  margin: 0;
  border: none;
  background: transparent;
  padding: 0 4px;
  cursor: pointer;
  color: inherit;
}

.sd-font-combobox.sd-disabled .sd-font-combobox__caret {
  cursor: default;
}

.sd-dropdown-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 10px;
}

.sd-font-combobox__listbox {
  min-width: 80px;
  padding: 4px;
  border-radius: var(--sd-ui-radius, 6px);
  background: var(--sd-ui-dropdown-bg, #fff);
  border: 1px solid var(--sd-ui-dropdown-border, #e4e6eb);
  box-shadow: var(--sd-ui-dropdown-shadow, 0 8px 24px rgba(0, 0, 0, 0.16));
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.sd-font-combobox__option {
  min-height: 34px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-radius: var(--sd-ui-dropdown-option-radius, 3px);
  cursor: pointer;
  font-size: var(--sd-ui-font-size-400, 14px);
  color: var(--sd-ui-dropdown-text, #47484a);
  transition: background-color 0.2s ease-out;
  box-sizing: border-box;
}

.sd-font-combobox__option.sd-active,
.sd-font-combobox__option:hover {
  background: var(--sd-ui-dropdown-hover-bg, #d8dee5);
  color: var(--sd-ui-dropdown-hover-text, #47484a);
}

.sd-font-combobox__option.sd-selected {
  background: var(--sd-ui-dropdown-active-bg, #d8dee5);
  color: var(--sd-ui-dropdown-selected-text, #47484a);
}

.sd-font-combobox__listbox.high-contrast .sd-font-combobox__option.sd-active,
.sd-font-combobox__listbox.high-contrast .sd-font-combobox__option:hover,
.sd-font-combobox__listbox.high-contrast .sd-font-combobox__option.sd-selected {
  background: #000;
  color: #fff;
}
</style>
