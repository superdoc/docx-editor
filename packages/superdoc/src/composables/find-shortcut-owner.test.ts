import { describe, it, expect, beforeEach } from 'vite-plus/test';
import {
  claimFindShortcut,
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
    const opened = [];
    const listenerFor = (owner, name) => (event) => {
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
    const opened = [];
    const listenerFor = (owner, name) => (event) => {
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
