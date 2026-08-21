import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PresentationInputBridge } from '../input/PresentationInputBridge.js';
import { CONTEXT_MENU_HANDLED_FLAG } from '../../../components/context-menu/event-flags.js';

describe('PresentationInputBridge - Context Menu Handling', () => {
  let bridge: PresentationInputBridge;
  let layoutSurface: HTMLElement;
  let targetDom: HTMLElement;
  let getTargetDom: () => HTMLElement | null;
  let isEditable: () => boolean;
  let windowRoot: Window;

  beforeEach(() => {
    // Create mock DOM elements
    layoutSurface = document.createElement('div');
    targetDom = document.createElement('div');
    document.body.appendChild(layoutSurface);
    document.body.appendChild(targetDom);

    // Mock callbacks
    getTargetDom = vi.fn(() => targetDom);
    isEditable = vi.fn(() => true);

    // Use real window
    windowRoot = window;

    // Create bridge instance
    bridge = new PresentationInputBridge(windowRoot, layoutSurface, getTargetDom, isEditable);
    bridge.bind();
  });

  afterEach(() => {
    // Unbind window-fallback listeners and detach this test's DOM so bridges
    // from one test cannot intercept events dispatched by later tests.
    bridge.destroy();
    layoutSurface.remove();
    targetDom.remove();
  });

  describe('#forwardContextMenu', () => {
    it('should forward context menu event when flag is NOT set', () => {
      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 200,
      });

      layoutSurface.dispatchEvent(event);

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'contextmenu',
          clientX: 100,
          clientY: 200,
        }),
      );
    });

    it('should NOT forward context menu event when CONTEXT_MENU_HANDLED_FLAG is set', () => {
      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 200,
      });

      // Set the flag to indicate ContextMenu handled it
      (event as MouseEvent & { [key: string]: boolean })[CONTEXT_MENU_HANDLED_FLAG] = true;

      layoutSurface.dispatchEvent(event);

      // Should not dispatch to target because ContextMenu already handled it
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should NOT forward when flag is truthy value', () => {
      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      });

      // Set flag to any truthy value
      (event as MouseEvent & { [key: string]: string })[CONTEXT_MENU_HANDLED_FLAG] = 'yes';

      layoutSurface.dispatchEvent(event);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should forward when flag is false', () => {
      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 200,
      });

      // Explicitly set flag to false
      (event as MouseEvent & { [key: string]: boolean })[CONTEXT_MENU_HANDLED_FLAG] = false;

      layoutSurface.dispatchEvent(event);

      expect(dispatchSpy).toHaveBeenCalled();
    });

    it('should forward when flag is undefined', () => {
      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 200,
      });

      // Flag is not set (undefined)
      layoutSurface.dispatchEvent(event);

      expect(dispatchSpy).toHaveBeenCalled();
    });

    it('should NOT forward when editor is not editable (regardless of flag)', () => {
      isEditable = vi.fn(() => false);
      bridge.destroy();
      bridge = new PresentationInputBridge(windowRoot, layoutSurface, getTargetDom, isEditable);
      bridge.bind();

      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      });

      layoutSurface.dispatchEvent(event);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should NOT forward when event is already prevented (regardless of flag)', () => {
      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      });

      // Prevent default before dispatching
      event.preventDefault();

      layoutSurface.dispatchEvent(event);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should check flag before checking editability', () => {
      // This test ensures the flag is checked first for performance
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      });
      (event as MouseEvent & { [key: string]: boolean })[CONTEXT_MENU_HANDLED_FLAG] = true;

      layoutSurface.dispatchEvent(event);

      // isEditable should not be called because flag check should short-circuit
      // Note: This is implementation detail testing, but important for performance
      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should preserve event coordinates when forwarding', () => {
      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 150,
        clientY: 250,
        screenX: 1150,
        screenY: 1250,
      });

      layoutSurface.dispatchEvent(event);

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          clientX: 150,
          clientY: 250,
          screenX: 1150,
          screenY: 1250,
        }),
      );
    });

    it('should preserve modifier keys when forwarding', () => {
      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
        metaKey: false,
      });

      layoutSurface.dispatchEvent(event);

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ctrlKey: true,
          shiftKey: true,
          altKey: true,
          metaKey: false,
        }),
      );
    });
  });

  describe('integration with ContextMenu flag', () => {
    it('should coordinate with ContextMenu capture phase handler', () => {
      // Simulate what happens in the real flow:
      // 1. ContextMenu sets flag in capture phase
      // 2. PresentationInputBridge checks flag in bubble phase
      const dispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');

      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      });

      // Simulate ContextMenu setting the flag during capture phase
      layoutSurface.addEventListener(
        'contextmenu',
        (e) => {
          (e as MouseEvent & { [key: string]: boolean })[CONTEXT_MENU_HANDLED_FLAG] = true;
        },
        true, // capture phase
      );

      layoutSurface.dispatchEvent(event);

      // Bridge should see the flag and not forward
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('stale hidden-editor rerouting', () => {
    it('does not double-forward layout-surface composing beforeinput when window fallback is enabled', () => {
      const event = new InputEvent('beforeinput', {
        data: 'e',
        inputType: 'insertCompositionText',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'isComposing', { value: true, writable: false });

      const forwardedEvents: string[] = [];
      targetDom.addEventListener('beforeinput', () => {
        forwardedEvents.push('beforeinput');
      });

      bridge.destroy();
      bridge = new PresentationInputBridge(windowRoot, layoutSurface, getTargetDom, isEditable, undefined, {
        useWindowFallback: true,
      });
      bridge.bind();

      layoutSurface.dispatchEvent(event);

      expect(forwardedEvents).toEqual(['beforeinput']);
    });

    it('reroutes beforeinput from a stale hidden editor to the active target when window fallback is enabled', () => {
      const staleBodyEditor = document.createElement('div');
      staleBodyEditor.className = 'ProseMirror';
      staleBodyEditor.setAttribute('contenteditable', 'true');
      document.body.appendChild(staleBodyEditor);

      const staleEvent = new InputEvent('beforeinput', {
        data: 'a',
        inputType: 'insertText',
        bubbles: true,
        cancelable: true,
      });

      const targetFocusSpy = vi.spyOn(targetDom, 'focus').mockImplementation(() => {});
      const targetDispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');

      bridge.destroy();
      bridge = new PresentationInputBridge(windowRoot, layoutSurface, getTargetDom, isEditable, undefined, {
        useWindowFallback: true,
      });
      bridge.bind();

      staleBodyEditor.dispatchEvent(staleEvent);

      expect(targetFocusSpy).toHaveBeenCalled();
      expect(targetDispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'beforeinput',
          data: 'a',
          inputType: 'insertText',
        }),
      );
      expect(staleEvent.defaultPrevented).toBe(true);
    });

    it('reroutes non-text keyboard commands from a stale hidden editor to the active target', () => {
      const staleBodyEditor = document.createElement('div');
      staleBodyEditor.className = 'ProseMirror';
      staleBodyEditor.setAttribute('contenteditable', 'true');
      document.body.appendChild(staleBodyEditor);

      const staleEvent = new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
      });

      const targetFocusSpy = vi.spyOn(targetDom, 'focus').mockImplementation(() => {});
      const targetDispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');

      bridge.destroy();
      bridge = new PresentationInputBridge(windowRoot, layoutSurface, getTargetDom, isEditable, undefined, {
        useWindowFallback: true,
      });
      bridge.bind();

      staleBodyEditor.dispatchEvent(staleEvent);

      expect(targetFocusSpy).toHaveBeenCalled();
      expect(targetDispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'keydown',
          key: 'Backspace',
        }),
      );
      expect(staleEvent.defaultPrevented).toBe(true);
    });

    it('still reroutes stale body-editor input when active target is a story editor in a different owned hidden host', () => {
      // Same-instance scenario the stale reroute exists for (SD-3249 regression
      // guard): a story session (footnote/header/footer) is active in its own
      // hidden host while native focus survived in the body editor's hidden
      // host. Both hosts belong to the SAME instance, so the reroute must run
      // even though the two ProseMirrors live in different hidden hosts.
      const bodyWrapper = document.createElement('div');
      bodyWrapper.className = 'presentation-editor__hidden-host-wrapper';
      const bodyHost = document.createElement('div');
      bodyHost.className = 'presentation-editor__hidden-host';
      const bodyEditor = document.createElement('div');
      bodyEditor.className = 'ProseMirror';
      bodyEditor.setAttribute('contenteditable', 'true');
      bodyHost.appendChild(bodyEditor);
      bodyWrapper.appendChild(bodyHost);
      document.body.appendChild(bodyWrapper);

      const storyWrapper = document.createElement('div');
      storyWrapper.className =
        'presentation-editor__hidden-host-wrapper presentation-editor__story-hidden-host-wrapper';
      const storyHost = document.createElement('div');
      storyHost.className = 'presentation-editor__hidden-host presentation-editor__story-hidden-host';
      const storyEditor = document.createElement('div');
      storyEditor.className = 'ProseMirror';
      storyEditor.setAttribute('contenteditable', 'true');
      storyHost.appendChild(storyEditor);
      storyWrapper.appendChild(storyHost);
      document.body.appendChild(storyWrapper);

      const storyFocusSpy = vi.spyOn(storyEditor, 'focus').mockImplementation(() => {});
      const storyDispatchSpy = vi.spyOn(storyEditor, 'dispatchEvent');

      bridge.destroy();
      bridge = new PresentationInputBridge(windowRoot, layoutSurface, () => storyEditor, isEditable, undefined, {
        useWindowFallback: true,
        ownsEditorDom: (element) => bodyWrapper.contains(element) || storyWrapper.contains(element),
      });
      bridge.bind();

      const staleEvent = new InputEvent('beforeinput', {
        data: 'a',
        inputType: 'insertText',
        bubbles: true,
        cancelable: true,
      });
      bodyEditor.dispatchEvent(staleEvent);

      expect(storyFocusSpy).toHaveBeenCalled();
      expect(storyDispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'beforeinput', data: 'a', inputType: 'insertText' }),
      );
      expect(staleEvent.defaultPrevented).toBe(true);

      bodyWrapper.remove();
      storyWrapper.remove();
    });

    it('does not reroute keyboard input from a registered UI surface editor', () => {
      const commentEditor = document.createElement('div');
      commentEditor.className = 'ProseMirror';
      commentEditor.setAttribute('contenteditable', 'true');

      const commentDialog = document.createElement('div');
      commentDialog.setAttribute('data-editor-ui-surface', '');
      commentDialog.appendChild(commentEditor);
      document.body.appendChild(commentDialog);

      const staleEvent = new KeyboardEvent('keydown', {
        key: 'U',
        bubbles: true,
        cancelable: true,
      });

      const targetFocusSpy = vi.spyOn(targetDom, 'focus').mockImplementation(() => {});
      const targetDispatchSpy = vi.spyOn(targetDom, 'dispatchEvent');

      bridge.destroy();
      bridge = new PresentationInputBridge(windowRoot, layoutSurface, getTargetDom, isEditable, undefined, {
        useWindowFallback: true,
      });
      bridge.bind();

      commentEditor.dispatchEvent(staleEvent);

      expect(targetFocusSpy).not.toHaveBeenCalled();
      expect(targetDispatchSpy).not.toHaveBeenCalled();
      expect(staleEvent.defaultPrevented).toBe(false);
    });
  });
});

describe('PresentationInputBridge - multiple instances on one page (SD-3249)', () => {
  type Instance = {
    layoutSurface: HTMLElement;
    hiddenHostWrapper: HTMLElement;
    editorDom: HTMLElement;
    bridge: PresentationInputBridge;
  };

  const instances: Instance[] = [];

  /**
   * Mirrors the production DOM of one PresentationEditor: a visible layout
   * surface plus a hidden-host wrapper appended to document.body containing
   * the hidden ProseMirror, with the bridge wired the way
   * PresentationEditor#setupInputBridge wires it (window fallback enabled,
   * instance-scoped editor ownership).
   */
  function createInstance(): Instance {
    const layoutSurface = document.createElement('div');
    document.body.appendChild(layoutSurface);

    const hiddenHostWrapper = document.createElement('div');
    hiddenHostWrapper.className = 'presentation-editor__hidden-host-wrapper';
    const hiddenHost = document.createElement('div');
    hiddenHost.className = 'presentation-editor__hidden-host';
    const editorDom = document.createElement('div');
    editorDom.className = 'ProseMirror';
    editorDom.setAttribute('contenteditable', 'true');
    hiddenHost.appendChild(editorDom);
    hiddenHostWrapper.appendChild(hiddenHost);
    document.body.appendChild(hiddenHostWrapper);

    const bridge = new PresentationInputBridge(
      window,
      layoutSurface,
      () => editorDom,
      () => true,
      undefined,
      {
        useWindowFallback: true,
        ownsEditorDom: (element) => hiddenHostWrapper.contains(element),
      },
    );
    bridge.bind();

    const instance = { layoutSurface, hiddenHostWrapper, editorDom, bridge };
    instances.push(instance);
    return instance;
  }

  afterEach(() => {
    while (instances.length) {
      const instance = instances.pop()!;
      instance.bridge.destroy();
      instance.layoutSurface.remove();
      instance.hiddenHostWrapper.remove();
    }
  });

  it('does not suppress or re-dispatch another instance’s beforeinput', () => {
    const a = createInstance();
    const b = createInstance();

    const bDispatchSpy = vi.spyOn(b.editorDom, 'dispatchEvent');
    const bFocusSpy = vi.spyOn(b.editorDom, 'focus').mockImplementation(() => {});

    // User types in instance A: the trusted event targets A's hidden editor.
    const event = new InputEvent('beforeinput', {
      data: 'h',
      inputType: 'insertText',
      bubbles: true,
      cancelable: true,
    });
    a.editorDom.dispatchEvent(event);

    // Instance B's window-capture listener must leave the event alone:
    // suppressing it blocks typing in A, and re-dispatching synthetics
    // ping-pongs between the two bridges until the stack overflows.
    expect(event.defaultPrevented).toBe(false);
    expect(bDispatchSpy).not.toHaveBeenCalled();
    expect(bFocusSpy).not.toHaveBeenCalled();
  });

  it('does not steal focus on another instance’s plain-character keydown', () => {
    const a = createInstance();
    const b = createInstance();

    const aFocusSpy = vi.spyOn(a.editorDom, 'focus').mockImplementation(() => {});
    const bFocusSpy = vi.spyOn(b.editorDom, 'focus').mockImplementation(() => {});

    const event = new KeyboardEvent('keydown', {
      key: 'h',
      bubbles: true,
      cancelable: true,
    });
    a.editorDom.dispatchEvent(event);

    expect(bFocusSpy).not.toHaveBeenCalled();
    expect(aFocusSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not intercept another instance’s non-text keyboard commands', () => {
    const a = createInstance();
    const b = createInstance();

    const bDispatchSpy = vi.spyOn(b.editorDom, 'dispatchEvent');
    const bFocusSpy = vi.spyOn(b.editorDom, 'focus').mockImplementation(() => {});

    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    a.editorDom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(bDispatchSpy).not.toHaveBeenCalled();
    expect(bFocusSpy).not.toHaveBeenCalled();
  });

  it('typing in either instance is left alone by the other bridge', () => {
    const a = createInstance();
    const b = createInstance();

    const aDispatchSpy = vi.spyOn(a.editorDom, 'dispatchEvent');
    const bDispatchSpy = vi.spyOn(b.editorDom, 'dispatchEvent');

    const eventForA = new InputEvent('beforeinput', {
      data: 'a',
      inputType: 'insertText',
      bubbles: true,
      cancelable: true,
    });
    a.editorDom.dispatchEvent(eventForA);

    const eventForB = new InputEvent('beforeinput', {
      data: 'b',
      inputType: 'insertText',
      bubbles: true,
      cancelable: true,
    });
    b.editorDom.dispatchEvent(eventForB);

    expect(eventForA.defaultPrevented).toBe(false);
    expect(eventForB.defaultPrevented).toBe(false);
    // Each editor only sees the event the user produced in it — no bridge
    // injected synthetic re-dispatches. (dispatchEvent may legitimately be
    // re-entered per propagation phase by the DOM implementation, so assert
    // on event identity rather than call counts.)
    expect(aDispatchSpy.mock.calls.every(([dispatched]) => dispatched === eventForA)).toBe(true);
    expect(bDispatchSpy.mock.calls.every(([dispatched]) => dispatched === eventForB)).toBe(true);
  });
});
