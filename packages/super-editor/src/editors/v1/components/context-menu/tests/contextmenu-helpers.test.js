import { describe, it, expect } from 'vitest';
import {
  shouldBypassContextMenu,
  shouldAllowNativeContextMenu,
  isWithinResizeOverlay,
} from '../../../utils/contextmenu-helpers.js';

describe('context menu helpers', () => {
  it('returns false for standard right click', () => {
    const event = {
      type: 'contextmenu',
      ctrlKey: false,
      metaKey: false,
      detail: 1,
      button: 2,
      clientX: 120,
      clientY: 150,
    };

    expect(shouldBypassContextMenu(event)).toBe(false);
    expect(shouldAllowNativeContextMenu(event)).toBe(false);
  });

  it('returns true when ctrl key is pressed', () => {
    const event = {
      type: 'contextmenu',
      ctrlKey: true,
      metaKey: false,
      detail: 1,
      button: 2,
      clientX: 120,
      clientY: 150,
    };

    expect(shouldBypassContextMenu(event)).toBe(true);
    expect(shouldAllowNativeContextMenu(event)).toBe(true);
  });

  it('returns true for keyboard invocation', () => {
    const event = {
      type: 'contextmenu',
      ctrlKey: false,
      metaKey: false,
      detail: 0,
      button: 0,
      clientX: 0,
      clientY: 0,
    };

    expect(shouldBypassContextMenu(event)).toBe(true);
    expect(shouldAllowNativeContextMenu(event)).toBe(true);
  });
});

describe('isWithinResizeOverlay', () => {
  it('returns true for a target inside the table resize overlay', () => {
    const overlay = document.createElement('div');
    overlay.className = 'superdoc-table-resize-overlay';
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    overlay.appendChild(handle);

    expect(isWithinResizeOverlay(handle)).toBe(true);
    expect(isWithinResizeOverlay(overlay)).toBe(true);
  });

  it('returns true for a target inside the image resize overlay', () => {
    const overlay = document.createElement('div');
    overlay.className = 'superdoc-image-resize-overlay';
    const handle = document.createElement('div');
    overlay.appendChild(handle);

    expect(isWithinResizeOverlay(handle)).toBe(true);
  });

  it('returns false for editor content and non-element targets', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'hello';

    expect(isWithinResizeOverlay(paragraph)).toBe(false);
    expect(isWithinResizeOverlay(document.createTextNode('hello'))).toBe(false);
    expect(isWithinResizeOverlay(null)).toBe(false);
    expect(isWithinResizeOverlay(undefined)).toBe(false);
  });
});
