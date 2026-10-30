<script setup lang="ts">
import {
  ref,
  getCurrentInstance,
  onMounted,
  onActivated,
  onDeactivated,
  onBeforeUnmount,
  computed,
  nextTick,
  provide,
} from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { throttle } from './helpers.js';
import ButtonGroup from './ButtonGroup.vue';
import { preventEditorFocusTransfer } from './toolbar-focus-helpers.js';
import { RESPONSIVE_BREAKPOINTS } from './constants.js';
import { getSuperDocUiOwnerId } from '../../../core/superdoc-ui-owner.js';
import { resolveToolbarCommandId } from '../compatibility-catalog.js';
import type { BuiltInToolbar, ToolbarCommandItem } from '../built-in-toolbar.js';
import type { SelectionCapture } from '../../../public/ui/types.js';

type ToolbarHost = Pick<
  BuiltInToolbar,
  | 'superdoc'
  | 'config'
  | 'ui'
  | 'snapshot'
  | 'activeEditor'
  | 'toolbarContainer'
  | 'overflowItems'
  | 'getToolbarItemByGroup'
  | 'getAvailableWidth'
  | 'onToolbarResize'
  | 'emitCommand'
  | 'on'
  | 'off'
> & {
  pendingSelectionCapture?: SelectionCapture | null;
};

type ToolbarProxy = ComponentPublicInstance & { $toolbar?: ToolbarHost };

type ToolbarCommand = { item: ToolbarCommandItem; argument?: unknown; option?: unknown };

/**
 * The default font-family to use for toolbar UI surfaces when no custom font is configured.
 * This constant ensures consistency across the toolbar application.
 * @constant {string}
 */
const DEFAULT_UI_FONT_FAMILY = 'Arial, Helvetica, sans-serif';

const proxy: ToolbarProxy | null | undefined = getCurrentInstance()?.proxy;

function resolveToolbar(): ToolbarHost {
  const host = proxy?.$toolbar;
  if (!host) throw new Error('Toolbar found no $toolbar registered on its app.');
  return host;
}
const toolbar = resolveToolbar();
provide('sdToolbarOwnerId', getSuperDocUiOwnerId(toolbar.superdoc));
const emit = defineEmits(['command', 'toggle', 'select']);

let toolbarKey = ref(1);
const toolbarRoot = ref<HTMLDivElement | null>(null);
const toolbarStateVersion = ref(0);
const compactSideGroups = ref(false);
let containerResizeObserver: ResizeObserver | null = null;
let pendingSelectionCapture: SelectionCapture | null = null;
let renderedWidth = toolbar.getAvailableWidth();

/**
 * Computed property that determines the font-family to use for toolbar UI surfaces.
 * Retrieves the configured font from the toolbar instance's config and validates it.
 * Falls back to the default if no valid font is configured.
 */
const uiFontFamily = computed(() => {
  const configured = toolbar.config?.uiDisplayFallbackFont;

  // Validate that the configured value is a non-empty string
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }

  // Fall back to the default font family
  return DEFAULT_UI_FONT_FAMILY;
});

const showLeftSide = toolbar.config?.toolbarGroups?.includes('left');
const showRightSide = toolbar.config?.toolbarGroups?.includes('right');
const getFilteredItems = (position: string) => {
  void toolbarStateVersion.value;
  return toolbar.getToolbarItemByGroup(position);
};

const updateCompactSideGroups = () => {
  compactSideGroups.value = toolbar.getAvailableWidth() <= RESPONSIVE_BREAKPOINTS.lg;
};
// Cmd/Ctrl+F is owned by the shared find/replace surface (SuperDoc.vue
// `handleFindShortcut`), so the toolbar no longer opens its legacy search
// dropdown on that shortcut. The dropdown remains available via its button.

const captureFocusedControl = () => {
  const root = toolbarRoot.value;
  if (!root) return null;
  const ownerDocument = root.ownerDocument;
  const focused = ownerDocument.activeElement;
  if (!focused || !root.contains(focused)) return null;
  const control =
    focused.closest('[data-sd-part="toolbar-item"]') ?? focused.querySelector('[data-sd-part="toolbar-item"]');
  if (!control || (focused !== control && !focused.contains(control))) return null;
  const itemId = control.querySelector('[data-item]')?.getAttribute('data-item');
  if (!itemId) return null;
  return () => {
    const currentRoot = toolbarRoot.value;
    if (!currentRoot?.isConnected || focused.isConnected || ownerDocument.activeElement !== ownerDocument.body) return;
    const markers = Array.from(currentRoot.querySelectorAll('[data-item]'));
    for (const id of [itemId, 'btn-overflow']) {
      const target = markers
        .find((marker) => marker.getAttribute('data-item') === id)
        ?.closest('[data-sd-part="toolbar-item"]');
      if (target instanceof HTMLElement && target.getAttribute('aria-disabled') !== 'true') {
        target.focus({ preventScroll: true });
        return;
      }
    }
  };
};

const renderToolbar = async (restoreFocus?: (() => void) | null) => {
  toolbarKey.value += 1;
  await nextTick();
  restoreFocus?.();
};

const onWindowResized = async () => {
  const width = toolbar.getAvailableWidth();
  // Window and container notifications can describe the same layout. Remounting twice detaches dialog openers.
  if (width === renderedWidth) return;
  renderedWidth = width;
  const restoreFocus = captureFocusedControl();
  await toolbar.onToolbarResize();
  updateCompactSideGroups();
  await renderToolbar(restoreFocus);
};
const onResizeThrottled = throttle(onWindowResized, 300);

/**
 * Force a re-render when the toolbar's item arrays are rebuilt. `toolbarItems` / `overflowItems` are plain
 * fields on the SuperToolbar instance, not a reactive source this component tracks, so a rebuild (a new
 * active editor, or document fonts resolving via `fonts-changed`) is invisible until the render key changes.
 * SuperToolbar emits `toolbar-items-changed` on rebuild; bumping the key re-reads the new items into the DOM.
 */
const onToolbarItemsChanged = () => {
  const restoreFocus = captureFocusedControl();
  renderedWidth = toolbar.getAvailableWidth();
  updateCompactSideGroups();
  void renderToolbar(restoreFocus);
};

const onToolbarStateChanged = () => {
  toolbarStateVersion.value += 1;
};

function teardownListeners() {
  onResizeThrottled.cancel();
  window.removeEventListener('resize', onResizeThrottled);
  toolbar.off?.('toolbar-items-changed', onToolbarItemsChanged);
  toolbar.off?.('toolbar-state-change', onToolbarStateChanged);
  containerResizeObserver?.disconnect();
  containerResizeObserver = null;
}

function setupListeners() {
  teardownListeners();
  window.addEventListener('resize', onResizeThrottled);
  toolbar.on?.('toolbar-items-changed', onToolbarItemsChanged);
  toolbar.on?.('toolbar-state-change', onToolbarStateChanged);
  const container = toolbar.toolbarContainer;
  if (typeof ResizeObserver !== 'undefined' && toolbar.config?.responsiveToContainer && container) {
    containerResizeObserver = new ResizeObserver(() => {
      onResizeThrottled();
    });
    containerResizeObserver.observe(container);
  }
  updateCompactSideGroups();
}

onMounted(setupListeners);
onActivated(setupListeners);
onDeactivated(teardownListeners);
onBeforeUnmount(teardownListeners);

const captureSelection = () => {
  const editor = toolbar.activeEditor;
  if (!editor) {
    pendingSelectionCapture = null;
    toolbar.pendingSelectionCapture = null;
    return;
  }
  // Capture regardless of isHeaderOrFooter — format painter must work in H/F stories.
  pendingSelectionCapture = toolbar.ui?.selection?.capture?.() ?? null;
  toolbar.pendingSelectionCapture = pendingSelectionCapture;
};

const handleCommand = ({ item, argument, option }: ToolbarCommand) => {
  const commandId = resolveToolbarCommandId(item?.name?.value);
  const isDirectInlineToggle =
    item?.type === 'button' &&
    !item.isCustomToolbarItem &&
    commandId !== null &&
    ['bold', 'italic', 'underline', 'strikethrough'].includes(commandId) &&
    toolbar.snapshot?.commands?.[commandId]?.source === 'builtin';
  if (!isDirectInlineToggle) restoreSelection();
  toolbar.emitCommand({ item, argument, option });
};

const restoreSelection = () => {
  const editor = toolbar.activeEditor;
  if (!editor) return;
  // isHeaderOrFooter guard removed — ui.selection.restore() is story-aware on the controller side.
  const capture = toolbar.pendingSelectionCapture ?? pendingSelectionCapture;
  const ui = toolbar.ui;
  if (capture && typeof ui?.selection?.restore === 'function') {
    ui.selection.restore(capture);
  }
};

const handleToolbarMousedown = (e: MouseEvent) => {
  captureSelection();
  preventEditorFocusTransfer(e);
};
</script>

<template>
  <div
    class="superdoc-toolbar"
    ref="toolbarRoot"
    :key="toolbarKey"
    role="toolbar"
    aria-label="Toolbar"
    data-sd-part="toolbar"
    data-editor-ui-surface
    :data-superdoc-ui-owner="getSuperDocUiOwnerId(toolbar.superdoc)"
    @mousedown="handleToolbarMousedown"
  >
    <ButtonGroup
      tabindex="0"
      v-if="showLeftSide"
      :toolbar-items="getFilteredItems('left')"
      :overflow-items="toolbar.overflowItems"
      :compact-side-groups="compactSideGroups"
      :ui-font-family="uiFontFamily"
      position="left"
      @command="handleCommand"
      class="superdoc-toolbar-group-side"
    />
    <ButtonGroup
      tabindex="0"
      :toolbar-items="getFilteredItems('center')"
      :overflow-items="toolbar.overflowItems"
      :compact-side-groups="compactSideGroups"
      :ui-font-family="uiFontFamily"
      position="center"
      @command="handleCommand"
    />
    <ButtonGroup
      tabindex="0"
      v-if="showRightSide"
      :toolbar-items="getFilteredItems('right')"
      :overflow-items="toolbar.overflowItems"
      :compact-side-groups="compactSideGroups"
      :ui-font-family="uiFontFamily"
      position="right"
      @command="handleCommand"
      class="superdoc-toolbar-group-side"
    />
  </div>
</template>

<style scoped>
.superdoc-toolbar {
  display: flex;
  width: 100%;
  justify-content: space-between;
  background: var(--sd-ui-toolbar-bg, var(--sd-ui-bg, #ffffff));
  padding: var(--sd-ui-toolbar-padding-y, 4px) var(--sd-ui-toolbar-padding-x, 16px);
  box-sizing: border-box;
  font-family: var(--sd-ui-font-family, Arial, Helvetica, sans-serif);
  position: relative;
  z-index: var(--sd-ui-toolbar-z-index, 10);
}

@media (max-width: 768px) {
  .superdoc-toolbar {
    padding: 4px 10px;
    justify-content: inherit;
  }
}
</style>
