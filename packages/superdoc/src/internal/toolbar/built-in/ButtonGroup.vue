<script setup lang="ts">
import { computed, getCurrentInstance, ref, watch, onBeforeUnmount } from 'vue';
import type { ComponentPublicInstance, MaybeRef, PropType, Ref, StyleValue } from 'vue';
import ToolbarButton from './ToolbarButton.vue';
import ToolbarSeparator from './ToolbarSeparator.vue';
import OverflowMenu from './OverflowMenu.vue';
import ToolbarDropdown from './ToolbarDropdown.vue';
import FontFamilyCombobox from './FontFamilyCombobox.vue';
import FontSizeCombobox from './FontSizeCombobox.vue';
import SdTooltip from './SdTooltip.vue';
import { refocusEditorSurface } from './toolbar-focus-helpers.js';
import { useHighContrastMode } from '../../../composables/use-high-contrast-mode';
import type { BuiltInToolbar } from '../built-in-toolbar.js';
import type { SelectionCapture } from '../../../public/ui/types.js';

type ButtonItem = InstanceType<typeof ToolbarButton>['$props']['toolbarItem'];
type ComboBoxProps = InstanceType<typeof FontFamilyCombobox>['$props'];
type ComboBoxItem = ComboBoxProps['item'];
type ComboBoxCommand = Parameters<NonNullable<ComboBoxProps['onCommand']>>[0];
type ComboBoxTabOut = Parameters<NonNullable<ComboBoxProps['onTab-out']>>[0];
type DropdownOption = NonNullable<InstanceType<typeof ToolbarDropdown>['$props']['options']>[number];

export interface ToolbarGroupItem extends ButtonItem {
  type: string;
  id: Ref<string>;
  isNarrow: Ref<boolean | undefined>;
  isWide: Ref<boolean | undefined>;
  tooltip: Ref<string | undefined>;
  argument: Ref<unknown>;
  command?: unknown;
  splitButtonCommand?: unknown;
  restoreEditorFocus: boolean;
  dropdownStyles: Ref<StyleValue | undefined>;
  dropdownValueKey: Ref<string | undefined>;
  selectedValue: Ref<string | number | null | undefined>;
  nestedOptions: Ref<DropdownOption[]>;
}

export interface ToolbarGroupCommand {
  item: ToolbarGroupItem | ComboBoxItem;
  argument?: unknown;
  option?: DropdownOption | ComboBoxCommand['option'];
}

type FocusMoveEvent = {
  shiftKey?: boolean;
  target?: (EventTarget & Partial<Pick<Element, 'closest'>>) | null;
};

type ToolbarHost = Pick<BuiltInToolbar, 'ui' | 'superdoc' | 'toolbarItems' | 'overflowItems'> & {
  pendingSelectionCapture?: SelectionCapture | null;
};

type ButtonGroupProxy = ComponentPublicInstance & { $toolbar?: ToolbarHost };

const emit = defineEmits<{
  command: [payload: ToolbarGroupCommand];
  'item-clicked': [];
  'dropdown-update-show': [open: boolean];
}>();
const proxy: ButtonGroupProxy | null | undefined = getCurrentInstance()?.proxy;

const toolbarItemRefs = ref<HTMLElement[]>([]);
const buttonGroupRef = ref<HTMLDivElement | null>(null);
const props = defineProps({
  toolbarItems: {
    type: Array as PropType<ToolbarGroupItem[]>,
    required: true,
  },
  overflowItems: {
    type: Array as PropType<ToolbarGroupItem[]>,
    default: () => [],
  },
  /**
   * The font-family to use for UI elements like dropdowns and tooltips.
   * This ensures consistent typography across toolbar UI components.
   * @type {string}
   * @default 'Arial, Helvetica, sans-serif'
   */
  uiFontFamily: {
    type: String,
    default: 'Arial, Helvetica, sans-serif',
  },
  position: {
    type: String,
    default: 'left',
  },
  fromOverflow: {
    type: Boolean,
    default: false,
  },
  compactSideGroups: {
    type: Boolean,
    default: false,
  },
});

const currentItem = ref<ToolbarGroupItem | null>(null);
const { isHighContrastMode } = useHighContrastMode();
// Matches media query from SuperDoc.vue
const isMobile = window.matchMedia('(max-width: 768px)').matches;

const getPositionStyle = computed(() => {
  if (props.position === 'left') {
    return {
      minWidth: props.compactSideGroups ? 'auto' : '120px',
      justifyContent: 'flex-start',
    };
  }

  if (props.position === 'right') {
    return {
      minWidth: props.compactSideGroups ? 'auto' : '120px',
      justifyContent: 'flex-end',
    };
  }

  return {
    // Only grow if not on a mobile device
    flexGrow: isMobile ? 0 : 1,
    justifyContent: 'center',
  };
});

type TypedItem = Pick<ToolbarGroupItem, 'type'>;
type FontComboBoxItem = ToolbarGroupItem & ComboBoxItem;

const isButton = (item: TypedItem) => item.type === 'button';
const isDropdown = (item: TypedItem) => item.type === 'dropdown';
const isFontFamily = (item: ToolbarGroupItem): item is FontComboBoxItem =>
  item.type === 'dropdown' && item.name?.value === 'fontFamily';
const isFontSize = (item: ToolbarGroupItem): item is FontComboBoxItem =>
  item.type === 'dropdown' && item.name?.value === 'fontSize';
const isSeparator = (item: TypedItem) => item.type === 'separator';
const isOverflow = (item: TypedItem) => item.type === 'overflow';
const hasNestedOptions = (item: ToolbarGroupItem) => Boolean(item.nestedOptions?.value?.length);

const getExpanded = (item: { expand: MaybeRef<boolean> } | null) => {
  if (!item) return false;
  const expand = item.expand;
  if (typeof expand === 'object' && expand !== null && 'value' in expand) {
    return Boolean(expand.value);
  }
  return Boolean(expand);
};

const setExpanded = (item: { expand: Ref<boolean> }, open: boolean) => {
  if (!item?.expand) return;
  item.expand.value = open;
};

const handleToolbarButtonClick = (item: ToolbarGroupItem, argument: unknown = undefined) => {
  if (item.disabled.value) return;

  if (isOverflow(item)) {
    const willOpen = !getExpanded(item);
    if (willOpen) {
      closeDropdowns();
    }
    setExpanded(item, willOpen);
    currentItem.value = willOpen ? item : null;
    emit('item-clicked');
    return;
  }

  if (isDropdown(item)) {
    return;
  }

  if (currentItem.value && isDropdown(currentItem.value) && getExpanded(currentItem.value)) {
    closeDropdowns();
  }

  emit('item-clicked');
  // Forward the item's static `argument` (set via `useToolbarItem({ argument })`)
  // when no caller-provided argument exists. Lets buttons carry fixed args like
  // `{ direction: 'rtl' }` without needing a dropdown.
  const resolved = argument !== undefined ? argument : item.argument?.value;
  emit('command', resolved === undefined ? { item } : { item, argument: resolved });
};

const handleToolbarButtonTextSubmit = (item: ToolbarGroupItem, argument: string) => {
  if (item.disabled.value) return;
  currentItem.value = null;
  emit('command', { item, argument });
};

const handleSplitButtonMainClick = (item: ToolbarGroupItem) => {
  if (item.disabled.value) return;

  closeDropdowns();

  const splitCommand = item.splitButtonCommand;
  const dropdownCommand = item.command;
  const targetCommand = splitCommand || dropdownCommand;
  if (!targetCommand) return;

  const commandItem = { ...item, command: targetCommand };
  emit('item-clicked');
  emit('command', { item: commandItem });
};

const closeDropdowns = () => {
  const toolbarItems = proxy?.$toolbar?.toolbarItems || [];
  const overflowItems = proxy?.$toolbar?.overflowItems || [];
  const allItems = [...toolbarItems, ...overflowItems];

  const itemsToClose = allItems.length ? allItems : props.toolbarItems;
  itemsToClose.forEach((toolbarItem) => {
    const shouldCloseOverflow = isOverflow(toolbarItem) && !props.fromOverflow;
    if (isDropdown(toolbarItem) || shouldCloseOverflow) {
      setExpanded(toolbarItem, false);
    }
  });
  currentItem.value = null;
};

const handleSelect = (item: ToolbarGroupItem, option: DropdownOption) => {
  closeDropdowns();
  const value = item.dropdownValueKey.value ? option[item.dropdownValueKey.value] : option.label;
  emit('command', { item, argument: value, option });
  item.selectedValue.value = option.key;
  if (item.restoreEditorFocus) refocusEditorSurface(proxy?.$toolbar);
};

const handleComboboxCommand = (payload: ComboBoxCommand) => {
  emit('command', payload);
};

const handleComboboxItemClicked = () => {
  closeDropdowns();
  emit('item-clicked');
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

const getToolbarItemFocusTarget = (container: Element) => {
  if (!(container instanceof HTMLElement)) return null;
  if (container.classList.contains('sd-disabled')) return null;
  return (
    container.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled])') ||
    container.querySelector(
      'button:not([disabled]), [role="button"]:not(.sd-disabled), [tabindex]:not([tabindex="-1"])',
    )
  );
};

// Walk the toolbar-item siblings in `direction`, skipping separators/disabled
// controls, and move focus to the first item that exposes a focusable target.
const focusAdjacentToolbarControl = (event: FocusMoveEvent, direction: number) => {
  const current = event?.target?.closest?.('.sd-toolbar-item-ctn');
  if (!(current instanceof HTMLElement)) return false;

  let candidate = direction > 0 ? current.nextElementSibling : current.previousElementSibling;
  while (candidate) {
    const target = getToolbarItemFocusTarget(candidate);
    if (target instanceof HTMLElement) {
      current.setAttribute('tabindex', '-1');
      candidate.setAttribute('tabindex', '0');
      target.focus();
      return true;
    }
    candidate = direction > 0 ? candidate.nextElementSibling : candidate.previousElementSibling;
  }

  return false;
};

// Word-style Tab chain for the font-family combobox: Tab moves to the next
// toolbar control (the font-size field), Shift+Tab to the previous one, and the
// editor receives focus when there is no adjacent control to land on.
const handleComboboxTabOut = (event: ComboBoxTabOut) => {
  closeDropdowns();
  const direction = event?.shiftKey ? -1 : 1;
  if (!focusAdjacentToolbarControl(event, direction)) {
    focusEditorSurface();
  }
};

const handleFontSizeTabOut = (event: ComboBoxTabOut) => {
  closeDropdowns();
  if (event?.shiftKey) {
    if (!focusAdjacentToolbarControl(event, -1)) focusEditorSurface();
    return;
  }
  focusEditorSurface();
};

const handleEditorHandoff = () => {
  focusEditorSurface();
};

const dropdownOptions = (item: ToolbarGroupItem) => {
  if (!item.nestedOptions?.value?.length) return [];
  return item.nestedOptions.value.map((option) => {
    const isSelected = option?.type !== 'render' && item.selectedValue.value === option.key;
    return {
      ...option,
      props: {
        ...option.props,
        class: isSelected ? 'sd-selected' : '',
      },
    };
  });
};

const getDropdownAttributes = (option: DropdownOption, item: ToolbarGroupItem) => {
  return {
    role: 'menuitem',
    'aria-label': `${item.attributes.value.ariaLabel} - ${option.label}`,
  };
};

const moveToNextButton = (target: Element) => {
  const nextButton = target.closest('.sd-toolbar-item-ctn')?.nextElementSibling;
  if (nextButton instanceof HTMLElement) {
    target.setAttribute('tabindex', '-1');
    nextButton.setAttribute('tabindex', '0');
    nextButton.focus();
  }
};

const moveToPreviousButton = (target: Element) => {
  const previousButton = target.closest('.sd-toolbar-item-ctn')?.previousElementSibling;
  if (previousButton instanceof HTMLElement) {
    target.setAttribute('tabindex', '-1');
    previousButton.setAttribute('tabindex', '0');
    previousButton.focus();
  }
};

const moveToNextButtonGroup = (target: Element) => {
  const nextButtonGroup = target.closest('.button-group')?.nextElementSibling;
  if (nextButtonGroup instanceof HTMLElement) {
    nextButtonGroup.setAttribute('tabindex', '0');
    nextButtonGroup.focus();
  } else {
    // Move to the editor
    const editor = document.querySelector('.ProseMirror');
    if (editor instanceof HTMLElement) {
      editor.focus();
    }
  }
};

const moveToPreviousButtonGroup = (target: Element) => {
  const previousButtonGroup = target.closest('.button-group')?.previousElementSibling;
  if (previousButtonGroup instanceof HTMLElement) {
    previousButtonGroup.setAttribute('tabindex', '0');
    previousButtonGroup.focus();
  }
};

const activateToolbarItem = (item: ToolbarGroupItem) => {
  if (item.disabled.value) return;

  if (isDropdown(item)) {
    handleDropdownUpdateShowForItem(!getExpanded(item), item);
    return;
  }

  handleToolbarButtonClick(item);
};

// Implement keyboard navigation using Roving Tabindex
// https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_roving_tabindex
// Set tabindex to 0 for the current focused button
// Set tabindex to -1 for all other buttons
const handleKeyDown = (e: KeyboardEvent, item: ToolbarGroupItem) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const isTypingField = target.nodeName === 'INPUT' || target.nodeName === 'TEXTAREA';
  const isTypingToolbarItem = item.name.value === 'fontSize' || item.name.value === 'fontFamily';
  // If the user is typing in a field or textarea, and the toolbar item is one
  // of the inline combobox controls, don't prevent the default behavior.
  // don't prevent the default behavior. Allow normal typing behavior.
  if (isTypingField && isTypingToolbarItem) {
    return;
  }

  const handledKeys = ['Enter', ' ', 'Spacebar', 'Escape', 'ArrowRight', 'ArrowLeft', 'Tab'];
  if (!handledKeys.includes(e.key)) return;
  e.preventDefault();

  switch (e.key) {
    case 'Enter':
    case ' ':
    case 'Spacebar':
      activateToolbarItem(item);
      break;
    case 'Escape':
      closeDropdowns();
      break;
    case 'ArrowRight':
      closeDropdowns();
      moveToNextButton(target);
      break;
    case 'ArrowLeft':
      closeDropdowns();
      moveToPreviousButton(target);
      break;
    case 'Tab':
      if (e.shiftKey) {
        moveToPreviousButtonGroup(target);
      } else {
        moveToNextButtonGroup(target);
      }
      break;
    default:
      break;
  }
};
const handleFocus = () => {
  // Set the focus to the first button inside the button group that is not disabled
  const firstButton = toolbarItemRefs.value.find((item) => !item.classList.contains('sd-disabled'));
  if (firstButton) {
    firstButton.setAttribute('tabindex', '0');
    firstButton.focus();
  }
};

const handleDropdownUpdateShowForItem = (open: boolean, item: ToolbarGroupItem) => {
  emit('item-clicked');

  if (!open) {
    closeDropdowns();
    emit('dropdown-update-show', false);
    return;
  }

  closeDropdowns();
  currentItem.value = item;
  setExpanded(item, true);

  emit('dropdown-update-show', true);
};

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!currentItem.value) return;

  const target = event.target;
  if (!(target instanceof Element)) return;

  // Dropdown content is teleported outside the toolbar group.
  // Treat menu clicks as "inside" so option clicks do not close before selection.
  if (target.closest('[data-sd-part="dropdown-menu"]')) return;
  if (buttonGroupRef.value?.contains(target)) return;

  closeDropdowns();
};

const isCurrentItemExpanded = () => {
  return getExpanded(currentItem.value);
};

watch(
  isCurrentItemExpanded,
  (isOpen) => {
    if (isOpen) {
      document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    } else {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
});
</script>

<template>
  <div :style="getPositionStyle" class="button-group" role="group" @focus="handleFocus" ref="buttonGroupRef">
    <div
      v-for="(item, index) in toolbarItems"
      :key="item.id.value"
      :class="{
        narrow: item.isNarrow.value,
        wide: item.isWide.value,
        'sd-disabled': item.disabled.value,
      }"
      @keydown="(e) => handleKeyDown(e, item)"
      class="sd-toolbar-item-ctn"
      ref="toolbarItemRefs"
      :tabindex="index === 0 ? 0 : -1"
      :data-item-id="item.id.value"
    >
      <!-- toolbar separator -->
      <ToolbarSeparator v-if="isSeparator(item)" style="width: 20px" />

      <!-- Font-family editable combobox (typeahead + Word Tab chain) -->
      <SdTooltip
        v-if="isFontFamily(item) && hasNestedOptions(item)"
        trigger="hover"
        :disabled="!item.tooltip?.value"
        :content-style="{ fontFamily: props.uiFontFamily }"
      >
        <template #trigger>
          <FontFamilyCombobox
            :item="item"
            :ui-font-family="props.uiFontFamily"
            class="sd-toolbar-button sd-editor-toolbar-dropdown"
            @command="handleComboboxCommand"
            @item-clicked="handleComboboxItemClicked"
            @tab-out="handleComboboxTabOut($event)"
            @editor-handoff="handleEditorHandoff"
          />
        </template>
        <div>
          {{ item.tooltip }}
          <span v-if="item.disabled.value">(disabled)</span>
        </div>
      </SdTooltip>

      <!-- Font-size editable combobox (typeahead + Word Tab chain to the editor) -->
      <SdTooltip
        v-else-if="isFontSize(item) && hasNestedOptions(item)"
        trigger="hover"
        :disabled="!item.tooltip?.value"
        :content-style="{ fontFamily: props.uiFontFamily }"
      >
        <template #trigger>
          <FontSizeCombobox
            :item="item"
            :ui-font-family="props.uiFontFamily"
            class="sd-toolbar-button sd-editor-toolbar-dropdown"
            @command="handleComboboxCommand"
            @item-clicked="handleComboboxItemClicked"
            @tab-out="handleFontSizeTabOut($event)"
            @editor-handoff="handleEditorHandoff"
          />
        </template>
        <div>
          {{ item.tooltip }}
          <span v-if="item.disabled.value">(disabled)</span>
        </div>
      </SdTooltip>

      <!-- Toolbar button -->
      <ToolbarDropdown
        v-else-if="isDropdown(item) && item.nestedOptions?.value?.length"
        :options="dropdownOptions(item)"
        :disabled="item.disabled.value"
        :show="getExpanded(item)"
        :content-style="{ fontFamily: props.uiFontFamily }"
        placement="bottom-start"
        class="sd-toolbar-button sd-editor-toolbar-dropdown"
        @select="(key, option) => handleSelect(item, option)"
        @update:show="(open) => handleDropdownUpdateShowForItem(open, item)"
        :style="item.dropdownStyles.value"
        :menu-props="
          () => ({
            role: 'menu',
            style: { fontFamily: props.uiFontFamily },
            class: ['sd-toolbar-dropdown-menu', { 'high-contrast': isHighContrastMode }],
          })
        "
        :node-props="(option) => getDropdownAttributes(option, item)"
      >
        <template #trigger>
          <SdTooltip
            trigger="hover"
            :disabled="!item.tooltip?.value"
            :content-style="{ fontFamily: props.uiFontFamily }"
          >
            <template #trigger>
              <ToolbarButton
                :toolbar-item="item"
                :disabled="item.disabled.value"
                :allow-enter-propagation="true"
                @textSubmit="handleToolbarButtonTextSubmit(item, $event)"
                @mainClick="handleSplitButtonMainClick(item)"
              />
            </template>
            <div>
              {{ item.tooltip }}
              <span v-if="item.disabled.value">(disabled)</span>
            </div>
          </SdTooltip>
        </template>
      </ToolbarDropdown>

      <SdTooltip
        trigger="hover"
        v-else-if="isButton(item)"
        class="sd-editor-toolbar-tooltip"
        :content-style="{ fontFamily: props.uiFontFamily }"
      >
        <template #trigger>
          <ToolbarButton
            :toolbar-item="item"
            :is-overflow-item="fromOverflow"
            @textSubmit="handleToolbarButtonTextSubmit(item, $event)"
            @buttonClick="handleToolbarButtonClick(item)"
          />
        </template>
        <div v-if="item.tooltip">
          {{ item.tooltip }}
          <span v-if="item.disabled.value">(disabled)</span>
        </div>
      </SdTooltip>

      <!-- Overflow menu -->
      <OverflowMenu
        v-if="isOverflow(item) && overflowItems.length"
        :toolbar-item="item"
        :ui-font-family="props.uiFontFamily"
        @buttonClick="handleToolbarButtonClick(item)"
        :overflow-items="overflowItems"
        @close="closeDropdowns"
        @command="emit('command', $event)"
      />
    </div>
  </div>
</template>

<style lang="postcss" scoped>
.button-group {
  display: flex;
}
</style>
