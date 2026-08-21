<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed, markRaw } from 'vue';
import { Selection } from 'prosemirror-state';
import { isCellSelection } from '@extensions/table/tableHelpers/isCellSelection.js';
import { ContextMenuPluginKey } from '../../extensions/context-menu/context-menu.js';
import { getPropsByItemId, resolveContextMenuCommandEditor } from './utils.js';
import { shouldBypassContextMenu, isWithinResizeOverlay } from '../../utils/contextmenu-helpers.js';
import { moveCursorToMouseEvent } from '../cursor-helpers.js';
import { getEditorSurfaceElement } from '../../core/helpers/editorSurface.js';
import { getItems } from './menuItems.js';
import { getEditorContext } from './utils.js';
import { CONTEXT_MENU_HANDLED_FLAG } from './event-flags.js';
import { isMacOS } from '../../core/utilities/isMacOS.js';

const props = defineProps({
  editor: {
    type: Object,
    required: true,
  },
  openPopover: {
    type: Function,
    required: true,
  },
  closePopover: {
    type: Function,
    required: true,
  },
});

const searchInput = ref(null);
const searchQuery = ref('');
const isOpen = ref(false);
const menuPosition = ref({ left: '0px', top: '0px' });
const menuRef = ref(null);
const sections = ref([]);
const selectedId = ref(null);
const currentContext = ref(null); // Store context for action execution

const TABLE_SURFACE_SELECTOR = '.superdoc-table-fragment, .superdoc-table-cell';

const hasExpandedSelection = (selection) => {
  return (
    Number.isFinite(selection?.from) &&
    Number.isFinite(selection?.to) &&
    Number(selection.from) !== Number(selection.to)
  );
};

const setSelectionNearPos = (editor, pos, options = {}) => {
  if (!editor?.state?.doc || !Number.isFinite(pos)) return false;
  const doc = editor.state.doc;
  const maxPos = doc.content.size;
  const clampedPos = Math.max(0, Math.min(pos, maxPos));

  try {
    const resolved = doc.resolve(clampedPos);
    const nextSelection = Selection.near(resolved, 1);
    const tr = editor.state.tr.setSelection(nextSelection);
    if (options.addToHistory === false) {
      tr.setMeta('addToHistory', false);
    }
    editor.dispatch?.(tr);
    if (options.focus) {
      editor.focus?.();
    }
    return true;
  } catch {
    return false;
  }
};

// Helper to close menu if editor becomes read-only
const handleEditorUpdate = () => {
  if (!props.editor?.isEditable && isOpen.value) {
    closeMenu({ restoreCursor: false });
  }
};

// Flatten sections into items for navigation and filtering
const flattenedItems = computed(() => {
  const items = [];
  sections.value.forEach((section) => {
    section.items.forEach((item) => {
      items.push(item);
    });
  });
  return items;
});

// Filter items based on search query
const filteredItems = computed(() => {
  if (!searchQuery.value) {
    return flattenedItems.value;
  }

  return flattenedItems.value.filter((item) => item.label?.toLowerCase().includes(searchQuery.value.toLowerCase()));
});

// Get sections with filtered items for rendering
const filteredSections = computed(() => {
  if (!searchQuery.value) {
    return sections.value;
  }

  // If searching, return a single section with filtered items
  return [
    {
      id: 'search-results',
      items: filteredItems.value,
    },
  ];
});

/**
 * Watch for menu open/close state changes and manage search input focus.
 *
 * When the menu opens, automatically focuses the hidden search input to enable
 * immediate keyboard interaction (search filtering and navigation). Uses the
 * preventScroll option to avoid unwanted scrolling behavior.
 *
 * The preventScroll option is critical because:
 * - The search input is positioned off-screen (opacity: 0, height: 0)
 * - Without preventScroll, browsers may scroll parent containers to bring the
 *   focused element into view, causing jarring page jumps
 * - This ensures the menu appears at the cursor position without disrupting
 *   the user's viewport
 *
 * @param {boolean} open - The new value of isOpen (true when menu opens, false when closed)
 * @returns {void}
 */
watch(isOpen, (open) => {
  if (open) {
    nextTick(() => {
      if (searchInput.value) {
        // Use preventScroll to avoid scrolling the page when focusing the search input.
        // Without this, the browser may scroll parent containers to bring the input into view,
        // which causes unwanted page jumps when opening the context menu.
        searchInput.value.focus({ preventScroll: true });
      }
    });
  }
});

watch(flattenedItems, (newItems) => {
  if (newItems.length > 0) {
    selectedId.value = newItems[0].id;
  }
});

// Handle custom item rendering
const customItemRefs = new Map();

const setCustomItemRef = (el, item) => {
  if (el) {
    customItemRefs.set(item.id, { element: el, item });
    nextTick(() => {
      renderCustomItem(item.id);
    });
  }
};

const defaultRender = (context) => {
  // Access item from the refData or context
  const item = context.item || context.currentItem;
  const container = document.createElement('div');
  container.className = 'context-menu-default-content';

  if (item.icon) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'context-menu-item-icon';
    iconSpan.innerHTML = item.icon;
    container.appendChild(iconSpan);
  }

  const labelSpan = document.createElement('span');
  labelSpan.textContent = item.label;
  container.appendChild(labelSpan);

  return container;
};

const renderCustomItem = async (itemId) => {
  const refData = customItemRefs.get(itemId);
  if (!refData || refData.element.hasCustomContent) return;

  const { element, item } = refData;

  try {
    if (!currentContext.value) {
      currentContext.value = await getEditorContext(props.editor);
    }

    // Create context with item info for render functions
    const contextWithItem = { ...currentContext.value, currentItem: item };

    // Use custom render function or fall back to default
    const renderFunction = item.render || defaultRender;
    const customElement = renderFunction(contextWithItem);

    if (customElement instanceof HTMLElement) {
      element.innerHTML = '';
      element.appendChild(customElement);
      element.hasCustomContent = true;
    }
  } catch (error) {
    console.warn(`[ContextMenu] Error rendering custom item ${itemId}:`, error);
    // Fallback to default rendering
    const fallbackElement = defaultRender({ ...(currentContext.value || {}), currentItem: item });
    element.innerHTML = '';
    element.appendChild(fallbackElement);
    element.hasCustomContent = true;
  }
};

// Clean up custom item refs when menu closes
const cleanupCustomItems = () => {
  customItemRefs.forEach((refData) => {
    if (refData.element) {
      refData.element.hasCustomContent = false;
    }
  });
  customItemRefs.clear();
};

const handleGlobalKeyDown = (event) => {
  // SD-2747: ESCAPE / ArrowLeft dismiss the menu. When the menu was opened by the
  // slash hotkey the original `/` was preventDefault'd, so we reinsert it at the
  // anchor — matches Google Docs' trigger-menu behavior. When the menu was
  // opened by right-click no keystroke was suppressed and dismissal must NOT
  // mutate the document.
  //
  // AIDEV-NOTE: SD-2747 P2. The gate is `pluginState.trigger === 'slash'`; without
  // this, pressing Escape on a right-click context menu inserts an unwanted `/`
  // at the click position. ArrowLeft is included here because the hidden search
  // input owns focus while the menu is open, so the PM plugin's matching branch
  // never fires in practice — every dismissal in the live flow comes through
  // this handler.
  if ((event.key === 'Escape' || event.key === 'ArrowLeft') && isOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    const pluginState = ContextMenuPluginKey.getState(props.editor?.state);
    const anchorPos = pluginState?.anchorPos;
    const trigger = pluginState?.trigger;
    closeMenu({ restoreCursor: false });

    if (trigger === 'slash' && props.editor && anchorPos !== null && anchorPos !== undefined) {
      const tr = props.editor.state.tr.insertText('/', anchorPos);
      const insertedAt = anchorPos + 1;
      tr.setSelection(props.editor.state.selection.constructor.near(tr.doc.resolve(insertedAt)));
      props.editor.dispatch(tr);
    }
    props.editor?.focus?.();
    return;
  }

  // SD-2747: BACKSPACE / DELETE dismisses the menu without inserting the slash. Focus is on
  // the hidden search input while the menu is open, so the PM plugin's handleKeyDown does
  // not see these keys — we have to handle them here. Empty search means an explicit
  // dismissal; with a typed filter we let the input handle the deletion normally.
  if ((event.key === 'Backspace' || event.key === 'Delete') && isOpen.value && !searchQuery.value) {
    event.preventDefault();
    event.stopPropagation();
    closeMenu({ restoreCursor: true });
    props.editor?.focus?.();
    return;
  }

  // Only handle navigation/selection if menu is open and input is focused
  if (isOpen.value && (event.target === searchInput.value || (menuRef.value && menuRef.value.contains(event.target)))) {
    const currentItems = filteredItems.value;
    const currentIndex = currentItems.findIndex((item) => item.id === selectedId.value);
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        if (currentIndex < currentItems.length - 1) {
          selectedId.value = currentItems[currentIndex + 1].id;
        }
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        if (currentIndex > 0) {
          selectedId.value = currentItems[currentIndex - 1].id;
        }
        break;
      }
      case 'Enter': {
        event.preventDefault();
        const selectedItem = currentItems.find((item) => item.id === selectedId.value);
        if (selectedItem) {
          executeCommand(selectedItem);
        }
        break;
      }
    }
  }
};

/**
 * Handle clicks outside the menu to close it.
 * Uses pointerdown instead of mousedown because PresentationEditor's pointer handlers
 * call event.preventDefault() which suppresses mousedown events.
 * @param {PointerEvent|MouseEvent} event - The pointer or mouse event
 * @returns {void}
 */
const handleGlobalOutsideClick = (event) => {
  if (isOpen.value && menuRef.value && !menuRef.value.contains(event.target)) {
    // Only move cursor for left-clicks (button === 0).
    // For right-clicks (button === 2), preserve the current selection/cursor
    // because the contextmenu handler will open a new menu at the click position.
    // Also skip Ctrl+Click on Mac, which triggers contextmenu but reports button=0.
    const isCtrlClickOnMac = event.ctrlKey && isMacOS();
    const isLeftClick = event.button === 0 && !isCtrlClickOnMac;

    if (isLeftClick) {
      moveCursorToMouseEvent(event, props.editor);
    }
    closeMenu({ restoreCursor: false });
  }
};

/**
 * Determines whether the ContextMenu should handle a context menu event.
 * Checks if the editor is editable, context menu is enabled, and the event
 * should not be bypassed (e.g., modifier keys are not pressed).
 *
 * @param {MouseEvent} event - The context menu event to validate
 * @returns {boolean} true if the ContextMenu should handle the event, false otherwise
 */
const shouldHandleContextMenu = (event) => {
  const readOnly = !props.editor?.isEditable;
  const contextMenuDisabled = props.editor?.options?.disableContextMenu;
  const bypass = shouldBypassContextMenu(event);

  return !readOnly && !contextMenuDisabled && !bypass;
};

/**
 * Capture phase handler for context menu events that marks the event as handled by ContextMenu.
 * This flag is used by PresentationInputBridge to skip forwarding the event to the hidden editor,
 * preventing duplicate context menu handling.
 *
 * The capture phase ensures this runs before PresentationInputBridge's bubble phase handler,
 * allowing us to set the flag before the event reaches other handlers.
 *
 * @param {MouseEvent} event - The context menu event in capture phase
 */
const getContextMenuTargets = () => {
  const targets = new Set();
  const surface = getEditorSurfaceElement(props.editor);
  if (surface) {
    targets.add(surface);
  }

  const activeEditor = resolveContextMenuCommandEditor(props.editor);
  const activeDom = activeEditor?.view?.dom;
  if (activeDom instanceof HTMLElement) {
    targets.add(activeDom);
  }

  return [...targets];
};

const isEventWithinContextMenuTargets = (event) => {
  const target = event?.target;
  if (!(target instanceof Node)) {
    return false;
  }

  // The table/image resize overlays render as siblings of the editor surface, not inside it.
  // Right-clicks landing on their handles must still open the editor context menu instead of
  // falling through to the browser's native menu.
  if (isWithinResizeOverlay(target)) {
    return true;
  }

  return getContextMenuTargets().some(
    (surface) => surface === target || (typeof surface?.contains === 'function' && surface.contains(target)),
  );
};

const handleRightClickCapture = (event) => {
  try {
    if (isEventWithinContextMenuTargets(event) && shouldHandleContextMenu(event)) {
      event[CONTEXT_MENU_HANDLED_FLAG] = true;
    }
  } catch (error) {
    // Prevent handler crashes from breaking the event flow
    // Log warning but don't throw to allow other handlers to run
    console.warn('[ContextMenu] Error in capture phase context menu handler:', error);
  }
};

const handleRightClick = async (event) => {
  if (!isEventWithinContextMenuTargets(event)) {
    return;
  }

  if (!shouldHandleContextMenu(event)) {
    return;
  }

  event.preventDefault();

  // Update cursor position to the right-click location before opening context menu,
  // unless the click lands inside an active selection (keep selection intact).
  const editorState = props.editor?.state;
  const hasRangeSelection = hasExpandedSelection(editorState?.selection);
  let isClickInsideSelection = false;

  if (hasRangeSelection && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    const hit = props.editor?.posAtCoords?.({ left: event.clientX, top: event.clientY });
    if (typeof hit?.pos === 'number') {
      const { from, to } = editorState.selection;
      isClickInsideSelection = hit.pos >= from && hit.pos <= to;
    }
  }

  const target = event?.target;
  const tableSurface = target instanceof Element ? target.closest(TABLE_SURFACE_SELECTOR) : null;
  const tableCandidatePm = target instanceof Element ? target.closest('[data-pm-start]') : null;
  const tableAnchorPos = Number.isFinite(Number(tableCandidatePm?.dataset?.pmStart))
    ? Number(tableCandidatePm.dataset.pmStart)
    : null;
  const selectionIsCell = isCellSelection(editorState?.selection);

  if (tableSurface && Number.isFinite(tableAnchorPos) && !selectionIsCell && !hasRangeSelection) {
    setSelectionNearPos(props.editor, tableAnchorPos, { focus: true });
  } else if (!isClickInsideSelection) {
    moveCursorToMouseEvent(event, props.editor);
  }

  try {
    const context = await getEditorContext(props.editor, event);
    const reseatForTable =
      Boolean(tableSurface) &&
      context?.isInTable &&
      Number.isFinite(context?.pos) &&
      !isCellSelection(props.editor?.state?.selection) &&
      !hasExpandedSelection(props.editor?.state?.selection);
    if (reseatForTable) {
      setSelectionNearPos(props.editor, context.pos, { focus: true });
    }
    currentContext.value = context;
    sections.value = getItems({ ...context, trigger: 'click' });
    selectedId.value = flattenedItems.value[0]?.id || null;
    searchQuery.value = '';

    const currentState = props.editor.state;
    if (!currentState) return;

    props.editor.dispatch(
      currentState.tr.setMeta(ContextMenuPluginKey, {
        type: 'open',
        pos: context?.pos ?? currentState.selection.from,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    );
  } catch (error) {
    console.error('[ContextMenu] Error opening context menu:', error);
  }
};

const executeCommand = async (item) => {
  if (props.editor) {
    const commandEditor = resolveContextMenuCommandEditor(props.editor);
    const currentPos = currentContext.value?.pos;
    const shouldReseatTableSelection =
      currentContext.value?.event?.type === 'contextmenu' &&
      currentContext.value?.isInTable &&
      Number.isFinite(currentPos) &&
      !isCellSelection(props.editor?.state?.selection) &&
      !hasExpandedSelection(props.editor?.state?.selection);

    if (shouldReseatTableSelection) {
      setSelectionNearPos(props.editor, currentPos, { focus: true, addToHistory: false });
    }

    // First call the action if needed on the item
    item.action ? await item.action(commandEditor, currentContext.value) : null;

    if (item.component) {
      const menuElement = menuRef.value;
      const componentProps = getPropsByItemId(item.id, {
        ...props,
        editor: commandEditor,
      });

      // Convert viewport-relative coordinates (used by fixed-position ContextMenu)
      // to container-relative coordinates (used by absolute-position GenericPopover)
      let popoverPosition = { left: menuPosition.value.left, top: menuPosition.value.top };
      if (menuElement) {
        const menuRect = menuElement.getBoundingClientRect();
        const container = menuElement.closest('.super-editor');
        if (container) {
          const containerRect = container.getBoundingClientRect();
          popoverPosition = {
            left: `${menuRect.left - containerRect.left}px`,
            top: `${menuRect.top - containerRect.top}px`,
          };
        }
      }

      props.openPopover(markRaw(item.component), componentProps, popoverPosition);
      closeMenu({ restoreCursor: false });
    } else {
      // For paste operations, don't restore cursor
      const shouldRestoreCursor = item.id !== 'paste';
      closeMenu({ restoreCursor: shouldRestoreCursor });
    }
  }
};

const closeMenu = (options = { restoreCursor: true }) => {
  if (!props.editor) return;
  const state = props.editor.state;
  if (!state) return;
  // Get plugin state to access anchorPos
  const pluginState = ContextMenuPluginKey.getState(state);
  const anchorPos = pluginState?.anchorPos;

  // Update prosemirror state to close menu
  props.editor.dispatch(state.tr.setMeta(ContextMenuPluginKey, { type: 'close' }));

  // Restore cursor position and focus only if requested
  if (options.restoreCursor && anchorPos !== null && anchorPos !== undefined) {
    const tr = props.editor.state.tr.setSelection(
      props.editor.state.selection.constructor.near(props.editor.state.doc.resolve(anchorPos)),
    );
    props.editor.dispatch(tr);
    props.editor.focus?.();
  }

  cleanupCustomItems();
  currentContext.value = null;

  // Update local state
  isOpen.value = false;
  searchQuery.value = '';
  sections.value = [];
};

/**
 * Lifecycle hooks on mount and onBeforeUnmount
 */
let contextMenuOpenHandler = null;
let contextMenuCloseHandler = null;

onMounted(() => {
  if (!props.editor) return;

  // Add global event listeners
  // Use pointerdown instead of mousedown because PresentationEditor's pointer handlers
  // call event.preventDefault() which suppresses mousedown events
  document.addEventListener('keydown', handleGlobalKeyDown);
  document.addEventListener('pointerdown', handleGlobalOutsideClick);
  document.addEventListener('contextmenu', handleRightClickCapture, true);
  document.addEventListener('contextmenu', handleRightClick);

  // Close menu if the editor becomes read-only while it's open
  props.editor.on('update', handleEditorUpdate);

  // Listen for the slash menu to open
  contextMenuOpenHandler = async (event) => {
    // Prevent opening the menu in read-only mode
    const readOnly = !props.editor?.isEditable;
    if (readOnly) return;
    let nextSections = sections.value;
    // Set sections and selectedId when menu opens
    if (!currentContext.value) {
      const context = await getEditorContext(props.editor);
      currentContext.value = context; // Store context for later use
      nextSections = getItems({ ...context, trigger: 'slash' });
    } else if (sections.value.length === 0) {
      const trigger = currentContext.value.event?.type === 'contextmenu' ? 'click' : 'slash';
      nextSections = getItems({ ...currentContext.value, trigger });
    }

    if (!nextSections.length) {
      const state = props.editor?.state;
      if (state) {
        props.editor.dispatch(state.tr.setMeta(ContextMenuPluginKey, { type: 'close' }));
      }
      return;
    }

    sections.value = nextSections;
    menuPosition.value = event.menuPosition;
    searchQuery.value = '';
    selectedId.value = flattenedItems.value[0]?.id || null;
    isOpen.value = true;
  };
  props.editor.on('contextMenu:open', contextMenuOpenHandler);

  contextMenuCloseHandler = () => {
    cleanupCustomItems();
    isOpen.value = false;
    searchQuery.value = '';
    currentContext.value = null;
  };
  props.editor.on('contextMenu:close', contextMenuCloseHandler);
});

// Cleanup function for event listeners
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleGlobalKeyDown);
  document.removeEventListener('pointerdown', handleGlobalOutsideClick);
  document.removeEventListener('contextmenu', handleRightClickCapture, true);
  document.removeEventListener('contextmenu', handleRightClick);

  cleanupCustomItems();

  if (props.editor) {
    try {
      // Remove specific handlers to avoid removing other components' listeners
      if (contextMenuOpenHandler) {
        props.editor.off('contextMenu:open', contextMenuOpenHandler);
      }
      if (contextMenuCloseHandler) {
        props.editor.off('contextMenu:close', contextMenuCloseHandler);
      }
      props.editor.off('update', handleEditorUpdate);
    } catch (error) {
      console.warn('[ContextMenu] Error during cleanup:', error);
    }
  }
});
</script>

<template>
  <div v-if="isOpen" ref="menuRef" class="context-menu" :style="menuPosition" @pointerdown.stop>
    <!-- Hide the input visually but keep it focused for typing -->
    <input
      ref="searchInput"
      v-model="searchQuery"
      type="text"
      class="context-menu-hidden-input"
      @keydown="handleGlobalKeyDown"
      @keydown.stop
    />

    <!-- SD-2747: When the user types after `/`, the hidden input captures keystrokes and the
         menu filters silently. Without a visible echo of the search term the user only sees
         the menu shrink or vanish, with no signal that their typing is being interpreted as
         a filter. This header mirrors what the user is searching for so the interaction is
         visible. -->
    <div v-if="searchQuery" class="context-menu-search-header">
      <span class="context-menu-search-header-label">Searching:</span>
      <span class="context-menu-search-header-value">/{{ searchQuery }}</span>
    </div>

    <div class="context-menu-items">
      <template v-for="(section, sectionIndex) in filteredSections" :key="section.id">
        <!-- Render divider before section (except for first section) -->
        <div v-if="sectionIndex > 0 && section.items.length > 0" class="context-menu-divider" tabindex="0"></div>

        <!-- Render section items -->
        <template v-for="item in section.items" :key="item.id">
          <div
            class="context-menu-item"
            :class="{ 'sd-is-selected': item.id === selectedId }"
            @click="executeCommand(item)"
          >
            <!-- Custom rendered content or default rendering -->
            <div :ref="(el) => setCustomItemRef(el, item)" class="context-menu-custom-item">
              <!-- Fallback content for items without custom render (will be replaced by defaultRender) -->
              <template v-if="!item.render">
                <span v-if="item.icon" class="context-menu-item-icon" v-html="item.icon"></span>
                <span>{{ item.label }}</span>
              </template>
            </div>
          </div>
        </template>
      </template>

      <!-- SD-2747: Empty state. Without this the menu collapses to an invisible 0-height box
           when nothing matches the filter, so the user sees no feedback at all. -->
      <div v-if="searchQuery && filteredItems.length === 0" class="context-menu-empty">No matching commands</div>
    </div>
  </div>
</template>

<style>
.context-menu {
  position: fixed;
  z-index: 50;
  width: 180px;
  color: var(--sd-ui-menu-text, #47484a);
  background: var(--sd-ui-menu-bg, #ffffff);
  border-radius: var(--sd-ui-menu-radius, 0);
  overflow: hidden;
  box-shadow: var(--sd-ui-menu-shadow, 0 0 0 1px rgba(0, 0, 0, 0.05), 0px 10px 20px rgba(0, 0, 0, 0.1));
  margin-top: 0.5rem;
  font-size: var(--sd-ui-menu-font-size, 12px);
}

/* Hide the input but keep it functional */
.context-menu-hidden-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  height: 0;
  width: 0;
  padding: 0;
  margin: 0;
  border: none;
}

.context-menu-items {
  max-height: 300px;
  overflow-y: auto;
}

.context-menu-search-header {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--sd-ui-menu-border, #eee);
  background: var(--sd-ui-menu-header-bg, #fafafa);
  font-size: 11px;
  color: var(--sd-ui-menu-text-muted, #888);
}

.context-menu-search-header-label {
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 10px;
}

.context-menu-search-header-value {
  font-family: var(--sd-ui-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: var(--sd-ui-menu-text, #47484a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.context-menu-empty {
  padding: 10px 10px;
  color: var(--sd-ui-menu-text-muted, #888);
  font-style: italic;
  text-align: center;
}

.context-menu-search {
  padding: 0.5rem;
  border-bottom: 1px solid var(--sd-ui-menu-border, #eee);
}

.context-menu-search input {
  width: 100%;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--sd-ui-menu-input-border, #ddd);
  outline: none;
}

.context-menu-search input:focus {
  border-color: var(--sd-ui-menu-input-focus-border, #0096fd);
}

/* Remove unused group styles */
.context-menu-group-label {
  display: none;
}

.context-menu-item {
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
  display: flex;
  align-items: center;
}

.context-menu-item:hover {
  background: var(--sd-ui-menu-item-hover-bg, #f5f5f5);
}

.context-menu-item.sd-is-selected {
  background: var(--sd-ui-menu-item-active-bg, #edf6ff);
  color: var(--sd-ui-menu-item-active-text, #0096fd);
  fill: var(--sd-ui-menu-item-active-text, #0096fd);
}

.context-menu-item-icon {
  display: flex;
  align-items: center;
  margin-right: 10px;
}

.context-menu .context-menu-item-icon svg {
  height: 12px;
  width: 12px;
}

.context-menu-custom-item {
  display: flex;
  align-items: center;
  width: 100%;
}

.context-menu-default-content {
  display: flex;
  align-items: center;
  width: 100%;
}

.sd-popover {
  background: var(--sd-ui-menu-bg, #ffffff);
  border-radius: var(--sd-ui-menu-radius, 0);
  box-shadow: var(--sd-ui-menu-shadow, 0 0 0 1px rgba(0, 0, 0, 0.05), 0px 10px 20px rgba(0, 0, 0, 0.1));
  z-index: 100;
}

.context-menu-divider {
  height: 1px;
  background: var(--sd-ui-menu-border, #eee);
  margin: 4px 0;
}
</style>
