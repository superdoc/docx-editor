<script setup>
import {
  ref,
  getCurrentInstance,
  onMounted,
  onActivated,
  onDeactivated,
  onBeforeUnmount,
  computed,
  nextTick,
} from 'vue';
import { throttle } from './helpers.js';
import ButtonGroup from './ButtonGroup.vue';
import { preventEditorFocusTransfer } from './toolbar-focus-helpers.js';
import { RESPONSIVE_BREAKPOINTS } from './constants.js';

/**
 * The default font-family to use for toolbar UI surfaces when no custom font is configured.
 * This constant ensures consistency across the toolbar application.
 * @constant {string}
 */
const DEFAULT_UI_FONT_FAMILY = 'Arial, Helvetica, sans-serif';

const { proxy } = getCurrentInstance();
const emit = defineEmits(['command', 'toggle', 'select']);

let toolbarKey = ref(1);
const toolbarRoot = ref(null);
const toolbarStateVersion = ref(0);
const compactSideGroups = ref(false);
let containerResizeObserver = null;
let pendingSelectionCapture = null;
let renderedWidth = proxy.$toolbar.getAvailableWidth();

/**
 * Computed property that determines the font-family to use for toolbar UI surfaces.
 * Retrieves the configured font from the toolbar instance's config and validates it.
 * Falls back to the default if no valid font is configured.
 */
const uiFontFamily = computed(() => {
  const configured = proxy?.$toolbar?.config?.uiDisplayFallbackFont;

  // Validate that the configured value is a non-empty string
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }

  // Fall back to the default font family
  return DEFAULT_UI_FONT_FAMILY;
});

const showLeftSide = proxy.$toolbar.config?.toolbarGroups?.includes('left');
const showRightSide = proxy.$toolbar.config?.toolbarGroups?.includes('right');
const excludeButtonsList = proxy.$toolbar.config?.toolbarButtonsExclude || [];

const getFilteredItems = (position) => {
  void toolbarStateVersion.value;
  return proxy.$toolbar.getToolbarItemByGroup(position).filter((item) => !excludeButtonsList.includes(item.name.value));
};

const updateCompactSideGroups = () => {
  compactSideGroups.value = proxy.$toolbar.getAvailableWidth() <= RESPONSIVE_BREAKPOINTS.lg;
};
// Cmd/Ctrl+F is owned by the shared find/replace surface (SuperDoc.vue
// `handleFindShortcut`), so the toolbar no longer opens its legacy search
// dropdown on that shortcut. The dropdown remains available via its button.

const captureFocusedControl = () => {
  const root = toolbarRoot.value;
  const ownerDocument = root?.ownerDocument;
  const focused = ownerDocument?.activeElement;
  if (!root?.contains(focused)) return null;
  const control =
    focused.closest('[data-sd-part="toolbar-item"]') ?? focused.querySelector('[data-sd-part="toolbar-item"]');
  if (!control || (focused !== control && !focused.contains(control))) return null;
  const itemId = control.querySelector('[data-item]')?.getAttribute('data-item');
  if (!itemId) return null;
  return () => {
    const currentRoot = toolbarRoot.value;
    if (!currentRoot?.isConnected || focused.isConnected || ownerDocument.activeElement !== ownerDocument.body) return;
    const markers = [...currentRoot.querySelectorAll('[data-item]')];
    for (const id of [itemId, 'btn-overflow']) {
      const target = markers
        .find((marker) => marker.getAttribute('data-item') === id)
        ?.closest('[data-sd-part="toolbar-item"]');
      if (target && target.getAttribute('aria-disabled') !== 'true') {
        target.focus({ preventScroll: true });
        return;
      }
    }
  };
};

const renderToolbar = async (restoreFocus) => {
  toolbarKey.value += 1;
  await nextTick();
  restoreFocus?.();
};

const onWindowResized = async () => {
  const width = proxy.$toolbar.getAvailableWidth();
  // Window and container notifications can describe the same layout. Remounting twice detaches dialog openers.
  if (width === renderedWidth) return;
  renderedWidth = width;
  const restoreFocus = captureFocusedControl();
  await proxy.$toolbar.onToolbarResize();
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
  renderedWidth = proxy.$toolbar.getAvailableWidth();
  updateCompactSideGroups();
  void renderToolbar(restoreFocus);
};

const onToolbarStateChanged = () => {
  toolbarStateVersion.value += 1;
};

function teardownListeners() {
  onResizeThrottled.cancel();
  window.removeEventListener('resize', onResizeThrottled);
  proxy.$toolbar.off?.('toolbar-items-changed', onToolbarItemsChanged);
  proxy.$toolbar.off?.('toolbar-state-change', onToolbarStateChanged);
  containerResizeObserver?.disconnect();
  containerResizeObserver = null;
}

function setupListeners() {
  teardownListeners();
  window.addEventListener('resize', onResizeThrottled);
  proxy.$toolbar.on?.('toolbar-items-changed', onToolbarItemsChanged);
  proxy.$toolbar.on?.('toolbar-state-change', onToolbarStateChanged);
  if (
    typeof ResizeObserver !== 'undefined' &&
    proxy.$toolbar.config?.responsiveToContainer &&
    proxy.$toolbar.toolbarContainer
  ) {
    containerResizeObserver = new ResizeObserver(() => {
      onResizeThrottled();
    });
    containerResizeObserver.observe(proxy.$toolbar.toolbarContainer);
  }
  updateCompactSideGroups();
}

onMounted(setupListeners);
onActivated(setupListeners);
onDeactivated(teardownListeners);
onBeforeUnmount(teardownListeners);

const captureSelection = () => {
  const editor = proxy.$toolbar.activeEditor;
  if (!editor) {
    pendingSelectionCapture = null;
    proxy.$toolbar.pendingSelectionCapture = null;
    return;
  }
  // Capture regardless of isHeaderOrFooter — format painter must work in H/F stories.
  pendingSelectionCapture = proxy.$toolbar.ui?.selection?.capture?.() ?? null;
  proxy.$toolbar.pendingSelectionCapture = pendingSelectionCapture;
};

const handleCommand = ({ item, argument, option }) => {
  restoreSelection();
  proxy.$toolbar.emitCommand({ item, argument, option });
};

const restoreSelection = () => {
  const editor = proxy.$toolbar.activeEditor;
  if (!editor) return;
  // isHeaderOrFooter guard removed — ui.selection.restore() is story-aware on the controller side.
  const capture = proxy.$toolbar.pendingSelectionCapture ?? pendingSelectionCapture;
  if (capture && typeof proxy.$toolbar.ui?.selection?.restore === 'function') {
    proxy.$toolbar.ui.selection.restore(capture);
    return;
  }
  editor.commands?.restoreSelection?.();
};

const handleToolbarMousedown = (e) => {
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
    @mousedown="handleToolbarMousedown"
  >
    <ButtonGroup
      tabindex="0"
      v-if="showLeftSide"
      :toolbar-items="getFilteredItems('left')"
      :overflow-items="proxy.$toolbar.overflowItems"
      :compact-side-groups="compactSideGroups"
      :ui-font-family="uiFontFamily"
      position="left"
      @command="handleCommand"
      class="superdoc-toolbar-group-side"
    />
    <ButtonGroup
      tabindex="0"
      :toolbar-items="getFilteredItems('center')"
      :overflow-items="proxy.$toolbar.overflowItems"
      :compact-side-groups="compactSideGroups"
      :ui-font-family="uiFontFamily"
      position="center"
      @command="handleCommand"
    />
    <ButtonGroup
      tabindex="0"
      v-if="showRightSide"
      :toolbar-items="getFilteredItems('right')"
      :overflow-items="proxy.$toolbar.overflowItems"
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
