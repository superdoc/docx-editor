import { describe, it, expect, beforeEach } from 'vite-plus/test';
import {
  claimFindShortcut,
  isFindShortcutEvent,
  releaseFindShortcut,
  ownsAmbientFindShortcut,
  shouldHandleFindShortcut,
} from './find-shortcut-owner.js';

describe('find-shortcut-owner', () => {
  const instanceA = { name: 'a' };
  const instanceB = { name: 'b' };

  beforeEach(() => {
    // Reset the module-level owner between tests.
    claimFindShortcut(instanceA);
    releaseFindShortcut(instanceA);
  });

  it('with no claimed owner, any instance may handle the ambient shortcut', () => {
    expect(ownsAmbientFindShortcut(instanceA)).toBe(true);
    expect(ownsAmbientFindShortcut(instanceB)).toBe(true);
  });

  it('the most recent claimant owns the ambient shortcut', () => {
    claimFindShortcut(instanceA);
    claimFindShortcut(instanceB);
    expect(ownsAmbientFindShortcut(instanceB)).toBe(true);
    expect(ownsAmbientFindShortcut(instanceA)).toBe(false);
  });

  it('release only clears ownership for the current owner', () => {
    claimFindShortcut(instanceB);
    releaseFindShortcut(instanceA);
    expect(ownsAmbientFindShortcut(instanceA)).toBe(false);
    releaseFindShortcut(instanceB);
    expect(ownsAmbientFindShortcut(instanceA)).toBe(true);
  });

  it('focus inside an instance always wins regardless of the ambient owner', () => {
    claimFindShortcut(instanceB);
    const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true });
    expect(shouldHandleFindShortcut(event, { focusInside: true, owner: instanceA })).toBe(true);
  });

  it('two-instance ambient Cmd+F: only the owning instance handles, and defaultPrevented suppresses the sibling capture listener', () => {
    // Two mounted SuperDoc instances each register a document-level capture
    // keydown listener. stopPropagation() cannot suppress a sibling listener
    // on the same node, so the decision function must: (a) gate the ambient
    // (body-focus) case on ownership, and (b) skip events another instance
    // already handled (defaultPrevented).
    claimFindShortcut(instanceB);
    const opened: string[] = [];
    const listenerFor = (owner: object, name: string) => (event: KeyboardEvent) => {
      if (!shouldHandleFindShortcut(event, { focusInside: false, owner })) return;
      event.preventDefault();
      opened.push(name);
    };
    const listenerA = listenerFor(instanceA, 'a');
    const listenerB = listenerFor(instanceB, 'b');
    document.addEventListener('keydown', listenerA, true);
    document.addEventListener('keydown', listenerB, true);
    try {
      // Focus is on <body> (nothing focused) — the ambient case.
      const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true, bubbles: true });
      document.dispatchEvent(event);
    } finally {
      document.removeEventListener('keydown', listenerA, true);
      document.removeEventListener('keydown', listenerB, true);
    }
    expect(opened).toEqual(['b']);
  });

  it('with no claimed owner, defaultPrevented alone still limits the ambient shortcut to one instance', () => {
    const opened: string[] = [];
    const listenerFor = (owner: object, name: string) => (event: KeyboardEvent) => {
      if (!shouldHandleFindShortcut(event, { focusInside: false, owner })) return;
      event.preventDefault();
      opened.push(name);
    };
    const listenerA = listenerFor(instanceA, 'a');
    const listenerB = listenerFor(instanceB, 'b');
    document.addEventListener('keydown', listenerA, true);
    document.addEventListener('keydown', listenerB, true);
    try {
      const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true, bubbles: true });
      document.dispatchEvent(event);
    } finally {
      document.removeEventListener('keydown', listenerA, true);
      document.removeEventListener('keydown', listenerB, true);
    }
    expect(opened).toEqual(['a']);
  });

  it('does not handle the ambient shortcut when focus is inside another element', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    try {
      const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true });
      expect(shouldHandleFindShortcut(event, { focusInside: false, owner: instanceA })).toBe(false);
    } finally {
      input.remove();
    }
  });
});

describe('platform Find command modifier', () => {
  for (const platform of ['MacIntel', 'Win32', 'Linux x86_64', 'iPhone', 'iPad', 'iPod']) {
    for (const modifiers of [
      { metaKey: true, ctrlKey: false },
      { metaKey: false, ctrlKey: true },
      { metaKey: true, ctrlKey: true },
      { metaKey: false, ctrlKey: false },
    ]) {
      const accepted = /Mac|iPhone|iPad|iPod/.test(platform)
        ? modifiers.metaKey && !modifiers.ctrlKey
        : modifiers.ctrlKey && !modifiers.metaKey;
      it(`${platform} Meta=${modifiers.metaKey} Ctrl=${modifiers.ctrlKey} preserves Find ownership and fallthrough`, () => {
        const previousOwner = {};
        const focusedOwner = {};
        claimFindShortcut(previousOwner);
        const opened: unknown[] = [];
        const handle = (event: KeyboardEvent) => {
          if (!isFindShortcutEvent(event, platform)) return;
          if (!shouldHandleFindShortcut(event, { focusInside: true, owner: focusedOwner })) return;
          event.preventDefault();
          claimFindShortcut(focusedOwner);
          opened.push(focusedOwner);
        };
        try {
          const event = new KeyboardEvent('keydown', { key: 'F', ...modifiers, cancelable: true });
          handle(event);
          handle(event);
          expect(event.defaultPrevented).toBe(accepted);
          expect(opened).toHaveLength(accepted ? 1 : 0);
          expect(ownsAmbientFindShortcut(previousOwner)).toBe(!accepted);
          const alt = new KeyboardEvent('keydown', { key: 'f', ...modifiers, altKey: true, cancelable: true });
          expect(isFindShortcutEvent(alt, platform)).toBe(false);
          expect(isFindShortcutEvent(new KeyboardEvent('keydown', { key: 'g', ...modifiers }), platform)).toBe(false);
        } finally {
          releaseFindShortcut(focusedOwner);
          releaseFindShortcut(previousOwner);
        }
      });
    }
  }

  it('leaves external inputs and already consumed Find keys alone', () => {
    const owner = {};
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    try {
      const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true });
      expect(isFindShortcutEvent(event, 'MacIntel')).toBe(true);
      expect(shouldHandleFindShortcut(event, { focusInside: false, owner })).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
      expect(shouldHandleFindShortcut(event, { focusInside: true, owner })).toBe(false);
    } finally {
      input.remove();
    }
  });
});
