import { isInRegisteredSurface } from '../utils/uiSurfaceRegistry.js';
import { CONTEXT_MENU_HANDLED_FLAG } from '../../../components/context-menu/event-flags.js';

const BRIDGE_FORWARDED_FLAG = Symbol('presentation-input-bridge-forwarded');

type BridgeTargetEditor = {
  focus?: () => void;
  state?: {
    selection?: unknown;
    tr?: {
      setSelection?: (selection: unknown) => unknown;
      setMeta?: (key: string, value: unknown) => unknown;
    };
  };
  view?: {
    dom?: HTMLElement | null;
    dispatch?: (transaction: unknown) => void;
  };
};

export class PresentationInputBridge {
  #windowRoot: Window;
  #layoutSurfaces: Set<EventTarget>;
  #getTargetDom: () => HTMLElement | null;
  #getTargetEditor?: () => BridgeTargetEditor | null;
  #ownsEditorDom?: (element: HTMLElement) => boolean;
  /** Callback that returns whether the editor is in an editable mode (editing/suggesting vs viewing) */
  #isEditable: () => boolean;
  #onTargetChanged?: (target: HTMLElement | null) => void;
  #listeners: Array<{ type: string; handler: EventListener; target: EventTarget; useCapture: boolean }>;
  #currentTarget: HTMLElement | null = null;
  #destroyed = false;
  #useWindowFallback: boolean;

  /**
   * Creates a new PresentationInputBridge that forwards user input events from the visible layout
   * surface to the hidden editor DOM. This enables input handling when the actual editor is not
   * directly visible to the user.
   *
   * @param windowRoot - The window object containing the layout surface and editor target
   * @param layoutSurface - The visible HTML element that receives user input events (e.g., keyboard, mouse)
   * @param getTargetDom - Callback that returns the hidden editor's DOM element where events should be forwarded
   * @param isEditable - Callback that returns whether the editor is in an editable mode (editing/suggesting).
   *                     When this returns false (e.g., in viewing mode), keyboard, text, and composition
   *                     events will not be forwarded to prevent document modification.
   * @param onTargetChanged - Optional callback invoked when the target editor DOM element changes
   * @param options - Optional configuration including:
   *                  - useWindowFallback: Whether to attach window-level event listeners as fallback
   *                  - getTargetEditor: Returns the active editor so focus restoration can
   *                    use editor-aware focus logic instead of raw DOM focus
   *                  - ownsEditorDom: Returns whether a hidden-editor element belongs to this
   *                    bridge's presentation editor instance. Window-fallback stale rerouting
   *                    only intercepts events from owned editors, so multiple SuperDoc
   *                    instances on one page do not hijack each other's input (SD-3249).
   */
  constructor(
    windowRoot: Window,
    layoutSurface: HTMLElement,
    getTargetDom: () => HTMLElement | null,
    isEditable: () => boolean,
    onTargetChanged?: (target: HTMLElement | null) => void,
    options?: {
      useWindowFallback?: boolean;
      getTargetEditor?: () => BridgeTargetEditor | null;
      ownsEditorDom?: (element: HTMLElement) => boolean;
    },
  ) {
    this.#windowRoot = windowRoot;
    this.#layoutSurfaces = new Set<EventTarget>([layoutSurface]);
    this.#getTargetDom = getTargetDom;
    this.#getTargetEditor = options?.getTargetEditor;
    this.#ownsEditorDom = options?.ownsEditorDom;
    this.#isEditable = isEditable;
    this.#onTargetChanged = onTargetChanged;
    this.#listeners = [];
    this.#useWindowFallback = options?.useWindowFallback ?? false;
  }

  bind() {
    if (this.#useWindowFallback) {
      this.#addListener('keydown', this.#captureStaleKeyboardEvent, this.#windowRoot, true);
      this.#addListener('beforeinput', this.#captureStaleTextEvent, this.#windowRoot, true);
      this.#addListener('input', this.#captureStaleTextEvent, this.#windowRoot, true);
      this.#addListener('compositionstart', this.#captureStaleCompositionEvent, this.#windowRoot, true);
      this.#addListener('compositionupdate', this.#captureStaleCompositionEvent, this.#windowRoot, true);
      this.#addListener('compositionend', this.#captureStaleCompositionEvent, this.#windowRoot, true);
    }

    const keyboardTargets = this.#getListenerTargets();
    keyboardTargets.forEach((target) => {
      this.#addListener('keydown', this.#forwardKeyboardEvent, target);
      this.#addListener('keyup', this.#forwardKeyboardEvent, target);
    });

    const compositionTargets = this.#getListenerTargets();
    compositionTargets.forEach((target) => {
      this.#addListener('compositionstart', this.#forwardCompositionEvent, target);
      this.#addListener('compositionupdate', this.#forwardCompositionEvent, target);
      this.#addListener('compositionend', this.#forwardCompositionEvent, target);
    });

    const textTargets = this.#getListenerTargets();
    textTargets.forEach((target) => {
      this.#addListener('beforeinput', this.#forwardTextEvent, target);
      this.#addListener('input', this.#forwardTextEvent, target);
      this.#addListener('textInput', this.#forwardTextEvent, target);
    });

    const contextTargets = this.#getListenerTargets();
    contextTargets.forEach((target) => {
      this.#addListener('contextmenu', this.#forwardContextMenu, target);
    });
  }

  destroy() {
    this.#listeners.forEach(({ type, handler, target, useCapture }) => {
      target.removeEventListener(type, handler, useCapture);
    });
    this.#listeners = [];
    this.#currentTarget = null;
    this.#destroyed = true;
  }

  notifyTargetChanged() {
    if (this.#destroyed) {
      return;
    }
    const nextTarget = this.#getTargetDom();
    if (nextTarget === this.#currentTarget) {
      return;
    }
    if (this.#currentTarget) {
      let synthetic: Event | null = null;
      if (typeof CompositionEvent !== 'undefined') {
        // Fire compositionend with empty data to complete any active composition.
        // Note: Empty string is the standard value for compositionend - it signals
        // that composition input is complete, not that the composed text is empty.
        // This ensures IME state is properly cleared when switching edit targets.
        synthetic = new CompositionEvent('compositionend', { data: '', bubbles: true, cancelable: true });
      } else {
        synthetic = new Event('compositionend', { bubbles: true, cancelable: true });
      }
      try {
        this.#currentTarget.dispatchEvent(synthetic);
      } catch (error) {
        // Ignore dispatch failures - can happen if target was removed from DOM
        if (process.env.NODE_ENV === 'development') {
          console.warn('[PresentationEditor] Failed to dispatch composition event:', error);
        }
      }
    }
    this.#currentTarget = nextTarget;
    this.#onTargetChanged?.(nextTarget ?? null);
  }

  #addListener<T extends Event>(type: string, handler: (event: T) => void, target: EventTarget, useCapture = false) {
    const bound = handler.bind(this) as EventListener;
    this.#listeners.push({ type, handler: bound, target, useCapture });
    target.addEventListener(type, bound, useCapture);
  }

  #dispatchToTarget(originalEvent: Event, synthetic: Event) {
    const target = this.#resolveDispatchTarget();
    if (!target) return;
    this.#dispatchToResolvedTarget(originalEvent, synthetic, target);
  }

  #dispatchToResolvedTarget(
    originalEvent: Event,
    synthetic: Event,
    target: HTMLElement,
    options?: { focusTarget?: boolean; suppressOriginal?: boolean; forceFocusTarget?: boolean },
  ) {
    if (this.#destroyed) return;
    const isConnected = (target as { isConnected?: boolean }).isConnected;
    if (isConnected === false) return;

    if (options?.suppressOriginal) {
      this.#suppressOriginalEvent(originalEvent);
    }

    if (options?.focusTarget) {
      this.#focusTargetDom(target, { force: options?.forceFocusTarget ?? false });
    }

    this.#currentTarget = target;
    try {
      const canceled = !target.dispatchEvent(synthetic) || synthetic.defaultPrevented;
      if (canceled) {
        originalEvent.preventDefault();
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PresentationEditor] Failed to dispatch event to target:', error);
      }
    }
  }

  #resolveDispatchTarget(): HTMLElement | null {
    const target = this.#getTargetDom();
    this.#currentTarget = target;
    if (!target) return null;
    const isConnected = (target as { isConnected?: boolean }).isConnected;
    if (isConnected === false) return null;
    return target;
  }

  #focusTargetDom(target: HTMLElement, options?: { force?: boolean }) {
    const forceFocusRestore = options?.force ?? false;
    const doc = target.ownerDocument ?? document;
    const selection = doc.getSelection?.() ?? null;
    const selectionInsideTarget = !!selection?.anchorNode && target.contains(selection.anchorNode);
    if (!forceFocusRestore && selectionInsideTarget) {
      return;
    }

    const targetEditor = this.#getTargetEditor?.() ?? null;
    const targetEditorDom = targetEditor?.view?.dom ?? null;
    if (targetEditorDom === target && typeof targetEditor?.focus === 'function') {
      targetEditor.focus();
      this.#syncEditorSelectionToDom(targetEditor);
      return;
    }

    const active = doc.activeElement as HTMLElement | null;
    const activeIsTarget = active === target || (!!active && target.contains(active));
    if (!forceFocusRestore && activeIsTarget) {
      return;
    }

    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }

    if (targetEditorDom === target) {
      this.#syncEditorSelectionToDom(targetEditor);
    }
  }

  /**
   * Re-apply the active editor's current PM selection after a stale-focus handoff.
   *
   * When native focus is still sitting inside a stale hidden editor, browsers can
   * transiently restore that stale DOM selection before forwarded text arrives.
   * Re-dispatching the current selection as a non-history transaction forces the
   * active hidden editor to write its real caret back into the DOM.
   */
  #syncEditorSelectionToDom(editor: BridgeTargetEditor | null | undefined) {
    const selection = editor?.state?.selection;
    const transaction = editor?.state?.tr;
    const dispatch = editor?.view?.dispatch;
    const setSelection = transaction?.setSelection;

    if (!selection || !transaction || typeof setSelection !== 'function' || typeof dispatch !== 'function') {
      return;
    }

    const selectionTransaction = setSelection.call(transaction, selection) as {
      setMeta?: (key: string, value: unknown) => unknown;
    };
    selectionTransaction?.setMeta?.('addToHistory', false);
    dispatch(selectionTransaction);
  }

  #suppressOriginalEvent(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  /**
   * Resolve a hidden editor DOM that still owns native focus even though a
   * different editor surface is currently active.
   *
   * This happens when body focus survives or is restored while a footnote /
   * header / footer session is visually active. Native input then targets the
   * stale hidden editor directly, bypassing the visible-surface bridge unless we
   * intercept and reroute it.
   */
  #resolveStaleEditorOrigin(event: Event): { activeTarget: HTMLElement; staleEditorTarget: HTMLElement } | null {
    const activeTarget = this.#resolveDispatchTarget();
    if (!activeTarget) {
      return null;
    }

    if (this.#isEventOnActiveTarget(event)) {
      return null;
    }

    if (this.#isInLayoutSurface(event)) {
      return null;
    }

    if (isInRegisteredSurface(event)) {
      return null;
    }

    const originNode = event.target as Node | null;
    const originElement =
      originNode instanceof HTMLElement
        ? originNode
        : originNode?.parentElement instanceof HTMLElement
          ? originNode.parentElement
          : null;
    const staleEditorTarget = originElement?.closest?.('.ProseMirror[contenteditable="true"]') as HTMLElement | null;

    if (!staleEditorTarget || staleEditorTarget === activeTarget) {
      return null;
    }

    // Multi-instance guard (SD-3249): only reroute input from editors owned by
    // this bridge's presentation editor instance. With several SuperDoc
    // instances on one page, every bridge's window-capture listener sees every
    // keystroke; without this check each bridge suppresses the other
    // instance's trusted events and re-dispatches synthetics that the other
    // bridge intercepts in turn, recursing until the stack overflows.
    if (this.#ownsEditorDom && !this.#ownsEditorDom(staleEditorTarget)) {
      return null;
    }

    return {
      activeTarget,
      staleEditorTarget,
    };
  }

  /**
   * Forwards keyboard events to the hidden editor, skipping IME composition events
   * and plain character keys (which are handled by beforeinput instead).
   * Uses microtask deferral to allow other handlers to preventDefault first.
   *
   * @param event - The keyboard event from the layout surface
   */
  #forwardKeyboardEvent(event: KeyboardEvent) {
    if (this.#wasForwardedByBridge(event)) {
      return;
    }
    if (!this.#isEditable()) {
      return;
    }
    if (this.#shouldSkipSurface(event)) {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    if (this.#isCompositionKeyboardEvent(event)) {
      return;
    }
    if (this.#isPlainCharacterKey(event)) {
      return;
    }
    this.#markForwardedByBridge(event);

    // Dispatch synchronously so browser defaults can still be prevented
    const synthetic = new KeyboardEvent(event.type, {
      key: event.key,
      code: event.code,
      location: event.location,
      repeat: event.repeat,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      bubbles: true,
      cancelable: true,
    });
    this.#dispatchToTarget(event, synthetic);
  }

  #captureStaleKeyboardEvent(event: KeyboardEvent) {
    if (!this.#isEditable()) {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }

    const staleOrigin = this.#resolveStaleEditorOrigin(event);
    if (!staleOrigin) {
      return;
    }

    // Plain text and IME composition complete through beforeinput/input.
    // Restore the active editor view first so the browser routes the follow-up
    // text events into the current story surface instead of the stale body DOM.
    // Non-text commands (Backspace, Enter, arrows, shortcuts) must also be
    // rerouted here because there may be no beforeinput.
    this.#focusTargetDom(staleOrigin.activeTarget);
    if (this.#isCompositionKeyboardEvent(event) || this.#isPlainCharacterKey(event)) {
      return;
    }

    const synthetic = new KeyboardEvent(event.type, {
      key: event.key,
      code: event.code,
      location: event.location,
      repeat: event.repeat,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      bubbles: true,
      cancelable: true,
    });
    this.#dispatchToResolvedTarget(event, synthetic, staleOrigin.activeTarget, {
      focusTarget: true,
      forceFocusTarget: true,
      suppressOriginal: true,
    });
  }

  /**
   * Forwards text input events (beforeinput) to the hidden editor.
   * Uses microtask deferral for cooperative handling.
   *
   * @param event - The input event from the layout surface
   */
  #forwardTextEvent(event: InputEvent | TextEvent) {
    if (this.#wasForwardedByBridge(event)) {
      return;
    }
    if (!this.#isEditable()) {
      return;
    }
    if (this.#shouldSkipSurface(event)) {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    this.#markForwardedByBridge(event);

    const dispatchSyntheticEvent = () => {
      // Only re-check mutable state - surface check was already done
      if (event.defaultPrevented) {
        return;
      }

      let synthetic: Event;
      if (typeof InputEvent !== 'undefined') {
        synthetic = new InputEvent(event.type, {
          data: (event as InputEvent).data ?? (event as TextEvent).data ?? null,
          inputType: (event as InputEvent).inputType ?? 'insertText',
          dataTransfer: (event as InputEvent).dataTransfer ?? null,
          isComposing: (event as InputEvent).isComposing ?? false,
          bubbles: true,
          cancelable: true,
        });
      } else {
        synthetic = new Event(event.type, { bubbles: true, cancelable: true });
      }
      this.#dispatchToTarget(event, synthetic);
    };

    if ((event as InputEvent).isComposing) {
      dispatchSyntheticEvent();
      return;
    }

    queueMicrotask(dispatchSyntheticEvent);
  }

  #captureStaleTextEvent(event: InputEvent | TextEvent) {
    if (!this.#isEditable()) {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }

    const staleOrigin = this.#resolveStaleEditorOrigin(event);
    if (!staleOrigin) {
      return;
    }

    let synthetic: Event;
    if (typeof InputEvent !== 'undefined') {
      synthetic = new InputEvent(event.type, {
        data: (event as InputEvent).data ?? (event as TextEvent).data ?? null,
        inputType: (event as InputEvent).inputType ?? 'insertText',
        dataTransfer: (event as InputEvent).dataTransfer ?? null,
        isComposing: (event as InputEvent).isComposing ?? false,
        bubbles: true,
        cancelable: true,
      });
    } else {
      synthetic = new Event(event.type, { bubbles: true, cancelable: true });
    }

    this.#dispatchToResolvedTarget(event, synthetic, staleOrigin.activeTarget, {
      focusTarget: true,
      forceFocusTarget: true,
      suppressOriginal: true,
    });
  }

  /**
   * Forwards composition events (compositionstart, compositionupdate, compositionend)
   * to the hidden editor for IME input handling.
   *
   * @param event - The composition event from the layout surface
   */
  #forwardCompositionEvent(event: CompositionEvent) {
    if (this.#wasForwardedByBridge(event)) {
      return;
    }
    if (!this.#isEditable()) {
      return;
    }
    if (this.#shouldSkipSurface(event)) {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    this.#markForwardedByBridge(event);

    let synthetic: Event;
    if (typeof CompositionEvent !== 'undefined') {
      synthetic = new CompositionEvent(event.type, {
        data: event.data ?? '',
        bubbles: true,
        cancelable: true,
      });
    } else {
      synthetic = new Event(event.type, { bubbles: true, cancelable: true });
    }
    this.#dispatchToTarget(event, synthetic);
  }

  #captureStaleCompositionEvent(event: CompositionEvent) {
    if (!this.#isEditable()) {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }

    const staleOrigin = this.#resolveStaleEditorOrigin(event);
    if (!staleOrigin) {
      return;
    }

    let synthetic: Event;
    if (typeof CompositionEvent !== 'undefined') {
      synthetic = new CompositionEvent(event.type, {
        data: event.data ?? '',
        bubbles: true,
        cancelable: true,
      });
    } else {
      synthetic = new Event(event.type, { bubbles: true, cancelable: true });
    }

    this.#dispatchToResolvedTarget(event, synthetic, staleOrigin.activeTarget, {
      focusTarget: true,
      forceFocusTarget: true,
      suppressOriginal: true,
    });
  }

  /**
   * Forwards context menu events to the hidden editor.
   *
   * Checks if the ContextMenu component has already handled the event by inspecting
   * the CONTEXT_MENU_HANDLED_FLAG. If the flag is set, the event is not forwarded,
   * preventing duplicate context menu handling. This coordination allows ContextMenu
   * to intercept right-clicks in the capture phase and prevent the default editor
   * context menu from appearing.
   *
   * @param event - The context menu event from the layout surface
   */
  #forwardContextMenu(event: MouseEvent) {
    // Skip forwarding if ContextMenu has already handled this event
    const handledByContextMenu = Boolean((event as unknown as Record<string, unknown>)[CONTEXT_MENU_HANDLED_FLAG]);
    if (handledByContextMenu) {
      return;
    }
    if (this.#wasForwardedByBridge(event)) {
      return;
    }
    if (!this.#isEditable()) {
      return;
    }
    if (this.#shouldSkipSurface(event)) {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    this.#markForwardedByBridge(event);
    const synthetic = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      button: event.button,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    this.#dispatchToTarget(event, synthetic);
  }

  #isEventOnActiveTarget(event: Event): boolean {
    const targetDom = this.#getTargetDom();
    if (!targetDom) return false;
    const origin = event.target as Node | null;
    if (!origin) return false;
    const targetNode = targetDom as unknown as Node;
    const containsFn =
      typeof (targetNode as { contains?: (node: Node | null) => boolean }).contains === 'function'
        ? (targetNode as { contains: (node: Node | null) => boolean }).contains
        : null;
    if (targetNode === origin) {
      return true;
    }
    if (containsFn) {
      return containsFn.call(targetNode, origin);
    }
    return false;
  }

  /**
   * Determines if an event originated from a UI surface that should be excluded
   * from keyboard forwarding (e.g., toolbars, dropdowns).
   *
   * Checks three conditions in order:
   * 1. Event is already on the active target (hidden editor) - skip to prevent loops
   * 2. Event is not in a layout surface - skip non-editor events
   * 3. Event is in a registered UI surface - skip toolbar/dropdown events
   *
   * @param event - The event to check
   * @returns true if the event should be skipped, false if it should be forwarded
   */
  #shouldSkipSurface(event: Event): boolean {
    if (this.#isEventOnActiveTarget(event)) {
      return true;
    }
    if (!this.#isInLayoutSurface(event)) {
      return true;
    }
    if (isInRegisteredSurface(event)) {
      return true;
    }
    return false;
  }

  /**
   * Checks if an event originated within a layout surface by walking the
   * event's composed path. Falls back to checking event.target directly
   * if composedPath is unavailable.
   *
   * @param event - The event to check
   * @returns true if event originated in a layout surface
   */
  #isInLayoutSurface(event: Event): boolean {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.length) {
      return path.some((node) => this.#layoutSurfaces.has(node as EventTarget));
    }
    const origin = event.target as EventTarget | null;
    return origin ? this.#layoutSurfaces.has(origin) : false;
  }

  #wasForwardedByBridge(event: Event): boolean {
    return Boolean((event as Event & { [BRIDGE_FORWARDED_FLAG]?: boolean })[BRIDGE_FORWARDED_FLAG]);
  }

  #markForwardedByBridge(event: Event) {
    (event as Event & { [BRIDGE_FORWARDED_FLAG]?: boolean })[BRIDGE_FORWARDED_FLAG] = true;
  }

  /**
   * Returns the set of event targets to attach listeners to.
   * Includes registered layout surfaces and optionally the window for fallback.
   *
   * @returns Set of EventTargets for listener attachment
   */
  #getListenerTargets(): EventTarget[] {
    const targets = new Set<EventTarget>(this.#layoutSurfaces);
    if (this.#useWindowFallback) {
      targets.add(this.#windowRoot);
    }
    return Array.from(targets);
  }

  /**
   * Determines if a keyboard event represents a plain character key without
   * modifiers. Plain character keys are filtered out because they should be
   * handled by the beforeinput event instead to avoid double-handling.
   *
   * Note: Shift is intentionally not considered a modifier here since
   * Shift+character produces a different character (e.g., uppercase) that
   * should still go through beforeinput.
   *
   * @param event - The keyboard event to check
   * @returns true if event is a single character without Ctrl/Meta/Alt modifiers
   */
  #isPlainCharacterKey(event: KeyboardEvent): boolean {
    return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  }

  /**
   * Detects keyboard events that represent IME/dead-key composition rather than
   * a command the hidden editor should process directly.
   */
  #isCompositionKeyboardEvent(event: KeyboardEvent): boolean {
    return event.isComposing || event.keyCode === 229 || event.key === 'Dead' || event.key === 'Compose';
  }
}
