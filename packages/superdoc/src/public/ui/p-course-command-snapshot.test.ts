import { describe, expect, it, vi } from 'vite-plus/test';
import { createSuperDocUI } from './create-super-doc-ui.js';

function mount() {
  const handlers = new Map<string, Set<() => void>>();
  let canUndo = true;
  const getSnapshot = vi.fn(() => ({
    commands: {
      'history.undo': { enabled: canUndo, reason: null, shippedStatus: 'supported', historyResolved: true },
      'history.redo': { enabled: false, reason: null, shippedStatus: 'supported', historyResolved: true },
    },
  }));
  const editor = {
    editorVersion: 2,
    editCommands: { getSnapshot, history: { undo: vi.fn(), redo: vi.fn() } },
    doc: { history: { get: () => ({ canUndo, canRedo: false }), undo: vi.fn(), redo: vi.fn() } },
  };
  const superdoc = {
    activeEditor: editor,
    on(event: string, listener: () => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(listener);
    },
    off(event: string, listener: () => void) {
      handlers.get(event)?.delete(listener);
    },
  };
  const ui = createSuperDocUI({ superdoc: superdoc as never });
  return {
    ui,
    superdoc,
    getSnapshot,
    setUndo(value: boolean) {
      canUndo = value;
    },
    refresh() {
      for (const listener of handlers.get('active-editor-change') ?? []) listener();
    },
  };
}

describe('command snapshots during UI state computation', () => {
  it('reads one complete command snapshot for an aggregate UI update', () => {
    const h = mount();
    try {
      h.getSnapshot.mockClear();
      h.refresh();
      expect(h.getSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      h.ui.destroy();
    }
  });

  it('refreshes command state on the next aggregate update', () => {
    const h = mount();
    try {
      expect(h.ui.commands.get('undo').getState().enabled).toBe(true);
      h.setUndo(false);
      h.getSnapshot.mockClear();
      h.refresh();
      expect(h.getSnapshot).toHaveBeenCalledTimes(1);
      expect(h.ui.commands.get('undo').getState().enabled).toBe(false);
    } finally {
      h.ui.destroy();
    }
  });

  it('releases a failed snapshot read before the next update', () => {
    const h = mount();
    try {
      h.getSnapshot.mockImplementationOnce(() => {
        throw new Error('Transient adapter failure');
      });
      h.refresh();
      h.getSnapshot.mockClear();
      h.refresh();
      expect(h.getSnapshot).toHaveBeenCalledTimes(1);
      expect(h.ui.commands.get('undo').getState().enabled).toBe(true);
    } finally {
      h.ui.destroy();
    }
  });
});
