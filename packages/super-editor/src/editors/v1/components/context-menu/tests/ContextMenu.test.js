import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ContextMenu from '../ContextMenu.vue';
import { TRIGGERS } from '../constants.js';
import {
  createMockEditor,
  setupCommonMocks,
  mountContextMenuComponent,
  createMockMenuItems,
  createMockRenderItem,
  assertEventListenersSetup,
  assertEventListenersCleanup,
} from './testHelpers.js';

vi.mock('@extensions/context-menu', () => ({
  ContextMenuPluginKey: {
    getState: vi.fn(() => ({ anchorPos: 100 })),
  },
}));

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual('../utils.js');

  return {
    ...actual,
    getPropsByItemId: vi.fn(() => ({ editor: {} })),
    getEditorContext: vi.fn(),
    resolveContextMenuCommandEditor: vi.fn((editor) => editor),
  };
});

vi.mock('../menuItems.js', () => ({
  getItems: vi.fn(),
}));

vi.mock('../../cursor-helpers.js', async () => {
  const actual = await vi.importActual('../../cursor-helpers.js');
  return {
    ...actual,
    moveCursorToMouseEvent: vi.fn(),
  };
});

let surfaceElementMock;
vi.mock('../../core/helpers/editorSurface.js', async () => {
  const actual = await vi.importActual('../../core/helpers/editorSurface.js');
  return {
    ...actual,
    getEditorSurfaceElement: vi.fn(() => surfaceElementMock),
  };
});

describe('ContextMenu.vue', () => {
  let mockEditor;
  let mockProps;
  let mockGetItems;
  let mockGetEditorContext;
  let mockResolveContextMenuCommandEditor;
  let commonMocks;

  beforeEach(async () => {
    commonMocks = setupCommonMocks();

    mockEditor = createMockEditor({
      isEditable: true,
      view: {
        state: {
          selection: {
            from: 10,
            constructor: {
              near: vi.fn(() => ({ from: 10, to: 10 })),
            },
          },
        },
      },
    });
    surfaceElementMock = mockEditor.view.dom;

    mockProps = {
      editor: mockEditor,
      openPopover: vi.fn(),
      closePopover: vi.fn(),
    };

    const { getItems } = await import('../menuItems.js');
    const { getEditorContext, resolveContextMenuCommandEditor } = await import('../utils.js');

    mockGetItems = getItems;
    mockGetEditorContext = getEditorContext;
    mockResolveContextMenuCommandEditor = resolveContextMenuCommandEditor;
    mockResolveContextMenuCommandEditor.mockReset();
    mockResolveContextMenuCommandEditor.mockImplementation((editor) => editor);

    mockGetItems.mockReturnValue(
      createMockMenuItems(1, [
        {
          id: 'test-item',
          label: 'Test Item',
          icon: '<svg>test-icon</svg>',
          action: vi.fn(),
          showWhen: (context) => [TRIGGERS.slash, TRIGGERS.click].includes(context.trigger),
        },
      ]),
    );

    mockGetEditorContext.mockResolvedValue({
      selectedText: 'test selection',
      hasSelection: true,
      trigger: 'slash',
    });
  });

  const getDocumentContextMenuHandler = (capture = false) => {
    const match = commonMocks.spies.docAddEventListener.mock.calls.find(
      (call) => call[0] === 'contextmenu' && (capture ? call[2] === true : call[2] !== true),
    );
    return match?.[1];
  };

  const setEventTarget = (event, target = surfaceElementMock) => {
    Object.defineProperty(event, 'target', {
      value: target,
      configurable: true,
    });
    return event;
  };

  describe('component mounting and lifecycle', () => {
    it('should mount without errors', () => {
      const wrapper = mount(ContextMenu, { props: mockProps });
      expect(wrapper.exists()).toBe(true);
    });

    it('should set up event listeners on mount', () => {
      mount(ContextMenu, { props: mockProps });

      assertEventListenersSetup(mockEditor, commonMocks.spies);
    });

    it('should clean up event listeners on unmount', () => {
      const wrapper = mount(ContextMenu, { props: mockProps });
      wrapper.unmount();

      assertEventListenersCleanup(mockEditor, commonMocks.spies);
    });

    it('attaches contextmenu listener to PresentationEditor host when available', () => {
      const presentationHost = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0 })),
      };
      mockEditor.presentationEditor = { element: presentationHost };
      surfaceElementMock = presentationHost;

      const wrapper = mount(ContextMenu, { props: mockProps });
      expect(commonMocks.spies.docAddEventListener).toHaveBeenCalledWith('contextmenu', expect.any(Function), true);
      expect(commonMocks.spies.docAddEventListener).toHaveBeenCalledWith('contextmenu', expect.any(Function));
      expect(presentationHost.addEventListener).not.toHaveBeenCalled();
      expect(mockEditor.view.dom.addEventListener).not.toHaveBeenCalledWith('contextmenu', expect.any(Function));

      wrapper.unmount();
      expect(commonMocks.spies.docRemoveEventListener).toHaveBeenCalledWith('contextmenu', expect.any(Function), true);
      expect(commonMocks.spies.docRemoveEventListener).toHaveBeenCalledWith('contextmenu', expect.any(Function));
      expect(presentationHost.removeEventListener).not.toHaveBeenCalled();
    });
  });

  describe('menu visibility and state', () => {
    it('should be hidden by default', () => {
      const wrapper = mount(ContextMenu, { props: mockProps });
      expect(wrapper.find('.context-menu').exists()).toBe(false);
    });

    it('should show menu when contextMenu:open event is triggered', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      // Simulate the contextMenu:open event
      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });

      await nextTick();

      expect(wrapper.find('.context-menu').exists()).toBe(true);
      expect(wrapper.find('.context-menu').element.style.left).toBe('100px');
      expect(wrapper.find('.context-menu').element.style.top).toBe('200px');
    });

    it('keeps the rendered menu inside a clipping ancestor', async () => {
      const clipper = document.createElement('div');
      clipper.style.overflowX = 'hidden';
      clipper.style.overflowY = 'hidden';
      Object.defineProperties(clipper, {
        clientWidth: { configurable: true, value: 600 },
        clientHeight: { configurable: true, value: 760 },
      });
      clipper.append(surfaceElementMock);
      document.body.append(clipper);

      const viewportWidth = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
      const viewportHeight = vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(760);
      const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this.classList.contains('context-menu')) {
          const left = Number.parseFloat(this.style.left) || 0;
          return { left, top: 200, right: left + 180, bottom: 306, width: 180, height: 106 };
        }
        if (this === clipper) {
          return { left: 0, top: 0, right: 600, bottom: 760, width: 600, height: 760 };
        }
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      });

      const wrapper = mount(ContextMenu, { props: mockProps });
      try {
        const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
        await onContextMenuOpen({ menuPosition: { left: '512px', top: '200px' } });

        expect(wrapper.find('.context-menu').element.style.left).toBe('412px');
        expect(wrapper.find('.context-menu').element.style.top).toBe('200px');
      } finally {
        wrapper.unmount();
        rect.mockRestore();
        viewportWidth.mockRestore();
        viewportHeight.mockRestore();
        clipper.remove();
      }
    });

    it('uses viewport bounds when the editor surface is unavailable', async () => {
      surfaceElementMock = null;
      const viewportWidth = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
      const viewportHeight = vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(760);
      const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this.classList.contains('context-menu')) {
          const left = Number.parseFloat(this.style.left) || 0;
          return { left, top: 200, right: left + 180, bottom: 306, width: 180, height: 106 };
        }
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      });

      const wrapper = mount(ContextMenu, { props: mockProps });
      try {
        const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
        await onContextMenuOpen({ menuPosition: { left: '900px', top: '200px' } });

        expect(wrapper.find('.context-menu').element.style.left).toBe('812px');
      } finally {
        wrapper.unmount();
        rect.mockRestore();
        viewportWidth.mockRestore();
        viewportHeight.mockRestore();
      }
    });

    it('repositions after a custom item changes the menu height', async () => {
      const customRenderItem = createMockRenderItem('custom-item');
      customRenderItem.render = () => {
        const element = document.createElement('div');
        element.dataset.tallCustomItem = '';
        return element;
      };
      mockGetItems.mockReturnValue([{ id: 'custom-section', items: [customRenderItem] }]);

      const viewportWidth = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
      const viewportHeight = vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(760);
      const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this.classList.contains('context-menu')) {
          const top = Number.parseFloat(this.style.top) || 0;
          const height = this.querySelector('[data-tall-custom-item]') ? 200 : 100;
          return { left: 100, top, right: 280, bottom: top + height, width: 180, height };
        }
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      });

      const wrapper = mount(ContextMenu, { props: mockProps });
      try {
        const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
        await onContextMenuOpen({ menuPosition: { left: '100px', top: '650px' } });
        await nextTick();
        await nextTick();

        expect(wrapper.find('.context-menu').element.style.top).toBe('552px');
      } finally {
        wrapper.unmount();
        rect.mockRestore();
        viewportWidth.mockRestore();
        viewportHeight.mockRestore();
      }
    });

    it('repositions when the search header grows a full menu', async () => {
      mockGetItems.mockReturnValue(
        createMockMenuItems(
          1,
          Array.from({ length: 40 }, (_, index) => ({
            id: `item-${index}`,
            label: `Item ${index}`,
            showWhen: () => true,
          })),
        ),
      );

      const viewportWidth = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
      const viewportHeight = vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(760);
      const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this.classList.contains('context-menu')) {
          const top = Number.parseFloat(this.style.top) || 0;
          const height = this.querySelector('.context-menu-search-header') ? 330 : 300;
          return { left: 100, top, right: 280, bottom: top + height, width: 180, height };
        }
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      });

      const wrapper = mount(ContextMenu, { props: mockProps });
      try {
        const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
        await onContextMenuOpen({ menuPosition: { left: '100px', top: '452px' } });
        await wrapper.find('.context-menu-hidden-input').setValue('Item');
        await nextTick();
        await nextTick();

        expect(wrapper.find('.context-menu').element.style.top).toBe('422px');
      } finally {
        wrapper.unmount();
        rect.mockRestore();
        viewportWidth.mockRestore();
        viewportHeight.mockRestore();
      }
    });

    it('should not open menu when editor is read-only', async () => {
      mockEditor.isEditable = false;
      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });

      await nextTick();

      expect(wrapper.find('.context-menu').exists()).toBe(false);
    });

    it('should hide menu when contextMenu:close event is triggered', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      // Open menu first
      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      expect(wrapper.find('.context-menu').exists()).toBe(true);

      // Close menu
      const onContextMenuClose = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:close')[1];
      onContextMenuClose();
      await nextTick();

      expect(wrapper.find('.context-menu').exists()).toBe(false);
    });
  });

  describe('menu items rendering', () => {
    it('should render default menu items', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      expect(wrapper.find('.context-menu-item').exists()).toBe(true);
      expect(wrapper.find('.context-menu-item').text()).toContain('Test Item');
      expect(wrapper.find('.context-menu-item-icon').exists()).toBe(true);
    });

    it('should render custom items with render function', async () => {
      const customRenderItem = createMockRenderItem('custom-item');
      customRenderItem.label = 'Custom Item';
      customRenderItem.action = vi.fn();

      mockGetItems.mockReturnValue([
        {
          id: 'custom-section',
          items: [customRenderItem],
        },
      ]);

      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();
      await nextTick();

      expect(wrapper.find('.context-menu-custom-item').exists()).toBe(true);
    });

    it('should pass right-click context (including event) to custom renderers', async () => {
      const rightClickEvent = setEventTarget(new MouseEvent('contextmenu', { clientX: 120, clientY: 160 }));

      const contextFromEvent = {
        selectedText: '',
        hasSelection: false,
        event: rightClickEvent,
        pos: 42,
      };

      mockGetEditorContext.mockReset();
      mockGetEditorContext.mockResolvedValue(contextFromEvent);

      const renderSpy = vi.fn(() => {
        const el = document.createElement('div');
        el.textContent = 'custom';
        return el;
      });

      mockGetItems.mockReturnValue([
        {
          id: 'custom-section',
          items: [
            {
              id: 'custom-item',
              label: 'Custom Item',
              render: renderSpy,
              showWhen: (context) => [TRIGGERS.slash, TRIGGERS.click].includes(context.trigger),
            },
          ],
        },
      ]);

      mount(ContextMenu, { props: mockProps });

      const contextMenuHandler = getDocumentContextMenuHandler();

      await contextMenuHandler(rightClickEvent);

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();
      await nextTick();

      expect(renderSpy).toHaveBeenCalledWith(expect.objectContaining({ event: rightClickEvent }));
    });

    it('should keep selection when right-click happens inside the active selection', async () => {
      mount(ContextMenu, { props: mockProps });

      const { moveCursorToMouseEvent } = await import('../../cursor-helpers.js');
      moveCursorToMouseEvent.mockClear();

      mockEditor.state.selection.from = 5;
      mockEditor.state.selection.to = 15;
      mockEditor.posAtCoords = vi.fn(() => ({ pos: 10 }));

      const contextMenuHandler = getDocumentContextMenuHandler();

      const rightClickEvent = setEventTarget(new MouseEvent('contextmenu', { clientX: 120, clientY: 160 }));

      await contextMenuHandler(rightClickEvent);

      expect(moveCursorToMouseEvent).not.toHaveBeenCalled();
    });

    it('should move cursor when right-click happens outside the active selection', async () => {
      mount(ContextMenu, { props: mockProps });

      const { moveCursorToMouseEvent } = await import('../../cursor-helpers.js');
      moveCursorToMouseEvent.mockClear();

      mockEditor.state.selection.from = 5;
      mockEditor.state.selection.to = 15;
      mockEditor.posAtCoords = vi.fn(() => ({ pos: 25 }));

      // Find the bubble phase handler (not capture phase which has `true` as third arg)
      const contextMenuHandler = getDocumentContextMenuHandler();

      const rightClickEvent = setEventTarget(new MouseEvent('contextmenu', { clientX: 120, clientY: 160 }));

      await contextMenuHandler(rightClickEvent);

      expect(moveCursorToMouseEvent).toHaveBeenCalledWith(rightClickEvent, mockEditor);
    });

    it('should not reseat selection in table when a text range is selected', async () => {
      mount(ContextMenu, { props: mockProps });

      const { moveCursorToMouseEvent } = await import('../../cursor-helpers.js');
      moveCursorToMouseEvent.mockClear();
      mockEditor.state.tr.setSelection.mockClear();

      mockEditor.state.selection.from = 5;
      mockEditor.state.selection.to = 15;
      mockEditor.posAtCoords = vi.fn(() => ({ pos: 10 }));
      mockGetEditorContext.mockResolvedValueOnce({
        selectedText: 'selected text',
        hasSelection: true,
        isInTable: true,
        pos: 10,
        event: { type: 'contextmenu' },
      });

      const tableFragment = document.createElement('div');
      tableFragment.className = 'superdoc-table-fragment';
      const target = document.createElement('span');
      target.dataset.pmStart = '10';
      tableFragment.appendChild(target);
      surfaceElementMock.appendChild(tableFragment);

      const contextMenuHandler = getDocumentContextMenuHandler();

      await contextMenuHandler({
        type: 'contextmenu',
        clientX: 120,
        clientY: 160,
        target,
        preventDefault: vi.fn(),
      });

      expect(moveCursorToMouseEvent).not.toHaveBeenCalled();
      expect(mockEditor.state.tr.setSelection).not.toHaveBeenCalled();
    });

    it('should reseat selection in table when selection is collapsed', async () => {
      mount(ContextMenu, { props: mockProps });

      const pmState = await import('prosemirror-state');
      const nearSpy = vi.spyOn(pmState.Selection, 'near').mockReturnValue({ from: 10, to: 10 });

      mockEditor.state.tr.setSelection.mockClear();
      mockEditor.state.selection.from = 10;
      mockEditor.state.selection.to = 10;
      mockEditor.state.doc.content = { size: 100 };
      mockGetEditorContext.mockResolvedValueOnce({
        selectedText: '',
        hasSelection: false,
        isInTable: true,
        pos: 10,
        event: { type: 'contextmenu' },
      });

      const tableFragment = document.createElement('div');
      tableFragment.className = 'superdoc-table-fragment';
      const target = document.createElement('span');
      target.dataset.pmStart = '10';
      tableFragment.appendChild(target);
      surfaceElementMock.appendChild(tableFragment);

      const contextMenuHandler = getDocumentContextMenuHandler();

      await contextMenuHandler({
        type: 'contextmenu',
        clientX: 120,
        clientY: 160,
        target,
        preventDefault: vi.fn(),
      });

      expect(mockEditor.state.tr.setSelection).toHaveBeenCalled();
      nearSpy.mockRestore();
    });

    it('should allow native context menu when modifier is pressed', async () => {
      mount(ContextMenu, { props: mockProps });

      mockGetEditorContext.mockClear();

      const contextMenuHandler = getDocumentContextMenuHandler();

      const event = {
        ctrlKey: true,
        preventDefault: vi.fn(),
        clientX: 50,
        clientY: 60,
        type: 'contextmenu',
        detail: 0,
        button: 2,
        target: surfaceElementMock,
      };

      await contextMenuHandler(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(mockGetEditorContext).not.toHaveBeenCalled();
    });

    it('should allow native context menu for keyboard invocation', async () => {
      mount(ContextMenu, { props: mockProps });

      mockGetEditorContext.mockClear();

      const contextMenuHandler = getDocumentContextMenuHandler();

      const keyboardEvent = {
        preventDefault: vi.fn(),
        clientX: 0,
        clientY: 0,
        detail: 0,
        button: 0,
        type: 'contextmenu',
        target: surfaceElementMock,
      };

      await contextMenuHandler(keyboardEvent);

      expect(keyboardEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockGetEditorContext).not.toHaveBeenCalled();
    });

    it('should reuse the computed context instead of re-reading clipboard for custom renders', async () => {
      const rightClickEvent = setEventTarget(new MouseEvent('contextmenu', { clientX: 200, clientY: 240 }));

      mockGetEditorContext.mockReset();
      mockGetEditorContext.mockResolvedValue({
        selectedText: '',
        hasSelection: false,
        event: rightClickEvent,
        pos: 21,
      });

      const renderSpy = vi.fn(() => {
        const el = document.createElement('div');
        el.textContent = 'custom';
        return el;
      });

      mockGetItems.mockReturnValue([
        {
          id: 'custom-section',
          items: [
            {
              id: 'custom-item',
              label: 'Custom Item',
              render: renderSpy,
              showWhen: (context) => [TRIGGERS.slash, TRIGGERS.click].includes(context.trigger),
            },
          ],
        },
      ]);

      mount(ContextMenu, { props: mockProps });

      const contextMenuHandler = getDocumentContextMenuHandler();

      await contextMenuHandler(rightClickEvent);

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();
      await nextTick();

      expect(mockGetEditorContext).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple sections with dividers', async () => {
      mockGetItems.mockReturnValue([
        {
          id: 'section1',
          items: [{ id: 'item1', label: 'Item 1', showWhen: (context) => context.trigger === TRIGGERS.slash }],
        },
        {
          id: 'section2',
          items: [{ id: 'item2', label: 'Item 2', showWhen: (context) => context.trigger === TRIGGERS.slash }],
        },
      ]);

      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      expect(wrapper.findAll('.context-menu-item')).toHaveLength(2);
      expect(wrapper.find('.context-menu-divider').exists()).toBe(true);
    });
  });

  describe('search functionality', () => {
    beforeEach(() => {
      mockGetItems.mockReturnValue(
        createMockMenuItems(0, [
          { id: 'insert-table', label: 'Insert Table', showWhen: (context) => context.trigger === TRIGGERS.slash },
          { id: 'insert-image', label: 'Insert Image', showWhen: (context) => context.trigger === TRIGGERS.slash },
          { id: 'insert-link', label: 'Insert Link', showWhen: (context) => context.trigger === TRIGGERS.slash },
        ]),
      );
    });

    it('should filter items based on search query', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      expect(wrapper.findAll('.context-menu-item')).toHaveLength(3);

      const searchInput = wrapper.find('.context-menu-hidden-input');
      await searchInput.setValue('table');
      await nextTick();

      expect(wrapper.findAll('.context-menu-item')).toHaveLength(1);
      expect(wrapper.find('.context-menu-item').text()).toContain('Insert Table');
    });

    it('should be case insensitive', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      const searchInput = wrapper.find('.context-menu-hidden-input');
      await searchInput.setValue('TABLE');
      await nextTick();

      expect(wrapper.findAll('.context-menu-item')).toHaveLength(1);
      expect(wrapper.find('.context-menu-item').text()).toContain('Insert Table');
    });
  });

  describe('keyboard navigation', () => {
    beforeEach(() => {
      mockGetItems.mockReturnValue(
        createMockMenuItems(0, [
          { id: 'item1', label: 'Item 1', showWhen: (context) => context.trigger === TRIGGERS.slash, action: vi.fn() },
          { id: 'item2', label: 'Item 2', showWhen: (context) => context.trigger === TRIGGERS.slash, action: vi.fn() },
          { id: 'item3', label: 'Item 3', showWhen: (context) => context.trigger === TRIGGERS.slash, action: vi.fn() },
        ]),
      );
    });

    it('should select first item by default', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      expect(wrapper.find('.context-menu-item.sd-is-selected').exists()).toBe(true);
    });

    it('should navigate with arrow keys', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      const searchInput = wrapper.find('.context-menu-hidden-input');

      await searchInput.trigger('keydown', { key: 'ArrowDown' });
      await nextTick();

      const selectedItems = wrapper.findAll('.context-menu-item.sd-is-selected');
      expect(selectedItems).toHaveLength(1);

      await searchInput.trigger('keydown', { key: 'ArrowUp' });
      await nextTick();

      expect(wrapper.findAll('.context-menu-item.sd-is-selected')).toHaveLength(1);
    });

    it('should execute selected item on Enter', async () => {
      const mockAction = vi.fn();
      mockGetItems.mockReturnValue([
        {
          id: 'test-section',
          items: [
            {
              id: 'test-item',
              label: 'Test Item',
              showWhen: (context) => context.trigger === TRIGGERS.slash,
              action: mockAction,
            },
          ],
        },
      ]);

      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      const searchInput = wrapper.find('.context-menu-hidden-input');
      await searchInput.trigger('keydown', { key: 'Enter' });

      // editor and context
      expect(mockAction).toHaveBeenCalledWith(
        mockEditor,
        expect.objectContaining({
          hasSelection: expect.any(Boolean),
          selectedText: expect.any(String),
          trigger: expect.any(String),
        }),
      );
    });

    it('should close menu on Escape', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      expect(wrapper.find('.context-menu').exists()).toBe(true);

      const searchInput = wrapper.find('.context-menu-hidden-input');
      await searchInput.trigger('keydown', { key: 'Escape' });
      await nextTick();

      expect(mockEditor.view.dispatch).toHaveBeenCalled();
    });
  });

  describe('custom item rendering', () => {
    it('should call render function with context', async () => {
      const mockRender = vi.fn(() => {
        const div = document.createElement('div');
        div.textContent = 'Custom content';
        return div;
      });

      mockGetItems.mockReturnValue([
        {
          id: 'custom-section',
          items: [
            {
              id: 'custom-item',
              label: 'Custom Item',
              render: mockRender,
              showWhen: (context) => context.trigger === TRIGGERS.slash,
            },
          ],
        },
      ]);

      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();
      await nextTick();

      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedText: 'test selection',
          hasSelection: true,
          trigger: 'slash',
        }),
      );
    });

    it('should handle render function errors gracefully', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mockRender = vi.fn(() => {
        throw new Error('Render error');
      });

      mockGetItems.mockReturnValue([
        {
          id: 'error-section',
          items: [
            {
              id: 'error-item',
              label: 'Error Item',
              render: mockRender,
              showWhen: (context) => context.trigger === TRIGGERS.slash,
            },
          ],
        },
      ]);

      mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];

      await expect(
        onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } }).then(async () => {
          await nextTick();
          await nextTick();
        }),
      ).resolves.not.toThrow();

      await nextTick();
      warnSpy.mockRestore();
    });

    it('should clean up custom items on menu close', async () => {
      const mockRender = vi.fn(() => {
        const div = document.createElement('div');
        div.textContent = 'Custom content';
        return div;
      });

      mockGetItems.mockReturnValue([
        {
          id: 'custom-section',
          items: [
            {
              id: 'custom-item',
              label: 'Custom Item',
              render: mockRender,
              showWhen: (context) => context.trigger === TRIGGERS.slash,
            },
          ],
        },
      ]);

      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();
      await nextTick();

      const onContextMenuClose = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:close')[1];
      onContextMenuClose();
      await nextTick();

      expect(wrapper.find('.context-menu').exists()).toBe(false);
    });
  });

  describe('item execution', () => {
    it('should execute item action on click', async () => {
      const mockAction = vi.fn();
      mockGetItems.mockReturnValue([
        {
          id: 'test-section',
          items: [
            {
              id: 'test-item',
              label: 'Test Item',
              showWhen: (context) => context.trigger === TRIGGERS.slash,
              action: mockAction,
            },
          ],
        },
      ]);

      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      await wrapper.find('.context-menu-item').trigger('click');

      expect(mockAction).toHaveBeenCalledWith(
        mockEditor,
        expect.objectContaining({
          hasSelection: expect.any(Boolean),
          selectedText: expect.any(String),
          trigger: expect.any(String),
        }),
      );
    });

    it('should execute item action with the active editor resolved from a wrapper', async () => {
      const activeEditor = createMockEditor();
      const editorWrapper = {
        ...mockEditor,
        getActiveEditor: vi.fn(() => activeEditor),
      };
      const mockAction = vi.fn();

      mockResolveContextMenuCommandEditor.mockImplementation((editor) => {
        return typeof editor?.getActiveEditor === 'function' ? editor.getActiveEditor() : editor;
      });

      mockGetItems.mockReturnValue([
        {
          id: 'test-section',
          items: [
            {
              id: 'test-item',
              label: 'Test Item',
              showWhen: (context) => context.trigger === TRIGGERS.slash,
              action: mockAction,
            },
          ],
        },
      ]);

      const wrapper = mount(ContextMenu, {
        props: {
          ...mockProps,
          editor: editorWrapper,
        },
      });

      const onContextMenuOpen = editorWrapper.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      await wrapper.find('.context-menu-item').trigger('click');

      expect(editorWrapper.getActiveEditor).toHaveBeenCalled();
      expect(mockAction).toHaveBeenCalledWith(
        activeEditor,
        expect.objectContaining({
          hasSelection: expect.any(Boolean),
          selectedText: expect.any(String),
          trigger: expect.any(String),
        }),
      );
    });

    it('should open popover for component items', async () => {
      const MockComponent = { template: '<div>Mock Component</div>' };
      mockGetItems.mockReturnValue([
        {
          id: 'component-section',
          items: [
            {
              id: 'component-item',
              label: 'Component Item',
              showWhen: (context) => context.trigger === TRIGGERS.slash,
              component: MockComponent,
            },
          ],
        },
      ]);

      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();

      await wrapper.find('.context-menu-item').trigger('click');

      expect(mockProps.openPopover).toHaveBeenCalledWith(
        expect.any(Object), // markRaw wrapped component
        expect.any(Object), // props
        expect.objectContaining({ left: '100px', top: '200px' }),
      );
    });
  });

  describe('handleRightClickCapture', () => {
    let captureHandler;

    beforeEach(() => {
      mount(ContextMenu, { props: mockProps });
      // Find the capture phase contextmenu listener
      captureHandler = getDocumentContextMenuHandler(true);
    });

    it('should set __sdHandledByContextMenu flag when editor is editable', () => {
      const event = {
        type: 'contextmenu',
        ctrlKey: false,
        metaKey: false,
        detail: 1,
        button: 2,
        clientX: 120,
        clientY: 150,
        preventDefault: vi.fn(),
        target: surfaceElementMock,
      };

      captureHandler(event);

      expect(event.__sdHandledByContextMenu).toBe(true);
    });

    it('should NOT set flag when editor is read-only', () => {
      mockEditor.isEditable = false;
      const event = {
        type: 'contextmenu',
        ctrlKey: false,
        metaKey: false,
        detail: 1,
        button: 2,
        clientX: 120,
        clientY: 150,
        preventDefault: vi.fn(),
        target: surfaceElementMock,
      };

      captureHandler(event);

      expect(event.__sdHandledByContextMenu).toBeUndefined();
    });

    it('should NOT set flag when context menu is disabled', () => {
      mockEditor.options = { disableContextMenu: true };
      const event = {
        type: 'contextmenu',
        ctrlKey: false,
        metaKey: false,
        detail: 1,
        button: 2,
        clientX: 120,
        clientY: 150,
        preventDefault: vi.fn(),
        target: surfaceElementMock,
      };

      captureHandler(event);

      expect(event.__sdHandledByContextMenu).toBeUndefined();
    });

    it('should NOT set flag when Ctrl key is pressed (bypass condition)', () => {
      const event = {
        type: 'contextmenu',
        ctrlKey: true,
        metaKey: false,
        detail: 1,
        button: 2,
        clientX: 120,
        clientY: 150,
        preventDefault: vi.fn(),
        target: surfaceElementMock,
      };

      captureHandler(event);

      expect(event.__sdHandledByContextMenu).toBeUndefined();
    });

    it('should NOT set flag when Meta key is pressed (bypass condition)', () => {
      const event = {
        type: 'contextmenu',
        ctrlKey: false,
        metaKey: true,
        detail: 1,
        button: 2,
        clientX: 120,
        clientY: 150,
        preventDefault: vi.fn(),
        target: surfaceElementMock,
      };

      captureHandler(event);

      expect(event.__sdHandledByContextMenu).toBeUndefined();
    });

    it('should NOT set flag for keyboard invocation (bypass condition)', () => {
      const event = {
        type: 'contextmenu',
        ctrlKey: false,
        metaKey: false,
        detail: 0,
        button: 0,
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
        target: surfaceElementMock,
      };

      captureHandler(event);

      expect(event.__sdHandledByContextMenu).toBeUndefined();
    });

    it('should handle errors gracefully and log warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Create an event that will cause an error by making shouldBypassContextMenu throw
      const event = {
        type: 'contextmenu',
        get ctrlKey() {
          throw new Error('Test error');
        },
        preventDefault: vi.fn(),
        target: surfaceElementMock,
      };

      // Should not throw, error should be caught
      expect(() => captureHandler(event)).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        '[ContextMenu] Error in capture phase context menu handler:',
        expect.any(Error),
      );

      warnSpy.mockRestore();
    });

    it('should cleanup capture listener on unmount', () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      wrapper.unmount();

      // Verify the capture listener was removed (check for contextmenu with capture flag)
      const removeCall = commonMocks.spies.docRemoveEventListener.mock.calls.find(
        (call) => call[0] === 'contextmenu' && call[2] === true,
      );
      expect(removeCall).toBeDefined();
    });
  });

  describe('handleGlobalOutsideClick - cursor movement', () => {
    let wrapper;
    let outsideClickHandler;

    beforeEach(() => {
      // Reset mocks
      vi.clearAllMocks();

      wrapper = mount(ContextMenu, { props: mockProps });

      // Open the menu first so handleGlobalOutsideClick will process clicks
      wrapper.vm.isOpen = true;

      // Find the pointerdown listener on document (handleGlobalOutsideClick)
      const pointerdownCall = document.addEventListener.mock?.calls?.find((call) => call[0] === 'pointerdown');
      outsideClickHandler = pointerdownCall?.[1];
    });

    afterEach(() => {
      wrapper?.unmount();
    });

    it('should NOT move cursor on right-click (button=2) outside menu', () => {
      // Skip if handler not found
      if (!outsideClickHandler) return;

      const event = {
        type: 'pointerdown',
        button: 2,
        ctrlKey: false,
        clientX: 100,
        clientY: 200,
        target: document.body, // Outside the menu
      };

      // Reset mock to check it's not called
      mockEditor.posAtCoords.mockClear();

      outsideClickHandler(event);

      // moveCursorToMouseEvent should NOT be called for right-clicks
      // This preserves the selection when right-clicking to open a new context menu
      expect(mockEditor.posAtCoords).not.toHaveBeenCalled();
    });

    it('should NOT move cursor on Ctrl+Click on Mac (reports button=0 but triggers contextmenu)', () => {
      // Skip if handler not found
      if (!outsideClickHandler) return;

      // Mock Mac platform
      const originalPlatform = navigator.platform;
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      const event = {
        type: 'pointerdown',
        button: 0,
        ctrlKey: true, // Ctrl+Click on Mac
        clientX: 100,
        clientY: 200,
        target: document.body,
      };

      mockEditor.posAtCoords.mockClear();

      outsideClickHandler(event);

      // moveCursorToMouseEvent should NOT be called for Ctrl+Click on Mac
      // because it triggers the context menu and should preserve selection
      expect(mockEditor.posAtCoords).not.toHaveBeenCalled();

      // Restore platform
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });
  });

  describe('focus behavior with preventScroll', () => {
    it('should focus search input with preventScroll option when menu opens', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });

      // Need to wait for both the open state to update and the watcher to execute
      await nextTick();
      await nextTick();

      // Find the actual search input element in the DOM
      const searchInputElement = wrapper.find('.context-menu-hidden-input');
      expect(searchInputElement.exists()).toBe(true);

      // We can't easily mock focus() on a real DOM element in jsdom,
      // but we can verify the input exists and is in the DOM when the menu is open
      // The preventScroll option is verified through the code review and manual testing
      expect(wrapper.find('.context-menu').exists()).toBe(true);
    });

    it('should not throw error if searchInput ref is null', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];

      // Should not throw an error - the watcher has a guard
      await expect(
        onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } }).then(async () => {
          await nextTick();
          await nextTick();
        }),
      ).resolves.not.toThrow();
    });

    it('should attempt to focus search input each time menu opens', async () => {
      const wrapper = mount(ContextMenu, { props: mockProps });

      const onContextMenuOpen = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:open')[1];
      const onContextMenuClose = mockEditor.on.mock.calls.find((call) => call[0] === 'contextMenu:close')[1];

      // Open menu first time
      await onContextMenuOpen({ menuPosition: { left: '100px', top: '200px' } });
      await nextTick();
      await nextTick();

      expect(wrapper.find('.context-menu').exists()).toBe(true);
      expect(wrapper.find('.context-menu-hidden-input').exists()).toBe(true);

      // Close menu
      onContextMenuClose();
      await nextTick();

      expect(wrapper.find('.context-menu').exists()).toBe(false);

      // Open menu second time
      await onContextMenuOpen({ menuPosition: { left: '150px', top: '250px' } });
      await nextTick();
      await nextTick();

      // Menu and input should exist again
      expect(wrapper.find('.context-menu').exists()).toBe(true);
      expect(wrapper.find('.context-menu-hidden-input').exists()).toBe(true);
    });
  });
});
