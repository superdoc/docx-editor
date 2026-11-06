import { describe, expect, it, vi } from 'vitest';
import { createSuperDocUI } from './create-super-doc-ui.js';

class PrototypeSelectionTargets {
  #placed: unknown[] = [];
  #selected: unknown[] = [];

  apply(): unknown {
    return { ok: true };
  }

  placeAroundContentControl(input: unknown): unknown {
    this.#placed.push(input);
    return { ok: true };
  }

  async applyAndWait(target: unknown): Promise<unknown> {
    this.#selected.push(target);
    return { ok: true };
  }

  get placed(): readonly unknown[] {
    return this.#placed;
  }

  get selected(): readonly unknown[] {
    return this.#selected;
  }
}

class ApplyOnlySelectionTargets {
  apply(): unknown {
    return { ok: true };
  }
}

function mount(selectionTargets: object, doc: object = {}) {
  const editor = {
    editorVersion: 2,
    doc,
    host: { getHandles: () => ({ editing: { selectionTargets } }) },
  };
  const ui = createSuperDocUI({ superdoc: { activeEditor: editor } as never });
  return ui;
}

describe('selection host reads over a helper that is not an object literal', () => {
  it('waits on the same helper and does not fall back to synchronous apply', async () => {
    const helper = new PrototypeSelectionTargets();
    const ui = mount(helper);
    const point = { kind: 'text' as const, blockId: 'new', offset: 0 };
    const target = { kind: 'selection' as const, start: point, end: point };
    try {
      await expect(ui.selection.applyAndWait(target)).resolves.toEqual({ ok: true });
      expect(helper.selected).toEqual([target]);
    } finally {
      ui.destroy();
    }
  });

  it('does not treat a synchronous apply helper as confirmation', async () => {
    const ui = mount(new ApplyOnlySelectionTargets());
    const point = { kind: 'text' as const, blockId: 'new', offset: 0 };
    try {
      await expect(ui.selection.applyAndWait({ kind: 'selection', start: point, end: point })).resolves.toEqual({
        ok: false,
        reason: 'host-capability-unavailable',
      });
    } finally {
      ui.destroy();
    }
  });

  it('anchors a comment to the confirmed selection after synchronous apply', async () => {
    const oldPoint = { kind: 'text' as const, blockId: 'P1', offset: 0 };
    const newPoint = { kind: 'text' as const, blockId: 'P2', offset: 0 };
    const target = { kind: 'selection' as const, start: newPoint, end: { ...newPoint, offset: 3 } };
    const create = vi.fn().mockResolvedValue({ success: true });
    let gate = 'open';
    const helper = {
      apply() {
        gate = 'pending';
        return { ok: true };
      },
      selectionRequestGate: () => gate,
      confirmedSelectionTarget: async () => ({ ok: true, target, mode: 'range' }),
    };
    const ui = mount(helper, { comments: { create } });
    try {
      expect(ui.selection.apply({ kind: 'selection', start: oldPoint, end: oldPoint })).toEqual({ ok: true });
      expect(ui.selection.apply(target)).toEqual({ ok: true });
      await ui.comments.createFromSelection({ text: 'New paragraph' });
      expect(create).toHaveBeenCalledWith({ target, text: 'New paragraph' });
    } finally {
      ui.destroy();
    }
  });

  it('refuses a comment when the selection request is blocked', async () => {
    const create = vi.fn();
    const ui = mount(
      {
        apply: () => ({ ok: true }),
        selectionRequestGate: () => 'blocked',
        confirmedSelectionTarget: async () => ({ ok: false, reason: 'selection-unconfirmed' }),
      },
      { comments: { create } },
    );
    try {
      expect(await ui.comments.createFromSelection({ text: 'New paragraph' })).toMatchObject({ success: false });
      expect(create).not.toHaveBeenCalled();
    } finally {
      ui.destroy();
    }
  });

  it('keeps a synchronous command away from the old selection while an async command waits', async () => {
    const oldPoint = { kind: 'text' as const, blockId: 'P1', offset: 0 };
    const newPoint = { kind: 'text' as const, blockId: 'P2', offset: 0 };
    const oldTarget = { kind: 'selection' as const, start: oldPoint, end: { ...oldPoint, offset: 4 } };
    const newTarget = { kind: 'selection' as const, start: newPoint, end: { ...newPoint, offset: 4 } };
    let gate = 'pending';
    let release!: () => void;
    const painted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bold = vi.fn(() => ({ success: true }));
    const doc = {
      selection: {
        current: () => ({
          empty: false,
          selectionTarget: gate === 'open' ? newTarget : oldTarget,
          target: gate === 'open' ? newTarget : oldTarget,
          activeMarks: [],
        }),
      },
      format: { bold },
    };
    const ui = mount(
      {
        apply: () => ({ ok: true }),
        selectionRequestGate: () => gate,
        whenSelectionRequestSettled: async () => {
          await painted;
          return 'open';
        },
      },
      doc,
    );
    try {
      expect(ui.commands.execute('bold')).toBe(false);
      expect(bold).not.toHaveBeenCalled();
      const pending = ui.commands.executeAsync('bold');
      expect(bold).not.toHaveBeenCalled();
      gate = 'open';
      release();
      await pending;
      expect(bold).toHaveBeenCalledWith(expect.objectContaining({ target: newTarget }), expect.anything());
    } finally {
      release();
      ui.destroy();
    }
  });

  it('reports a command refused when selection changes after its fresh read starts', async () => {
    const point = { kind: 'text' as const, blockId: 'P1', offset: 0 };
    const target = { kind: 'selection' as const, start: point, end: { ...point, offset: 4 } };
    const info = { empty: false, selectionTarget: target, target, activeMarks: [] };
    let gate: 'open' | 'pending' = 'open';
    let holdRead = false;
    let readEntered = false;
    let release!: (value: typeof info) => void;
    const pendingRead = new Promise<typeof info>((resolve) => {
      release = resolve;
    });
    const bold = vi.fn(() => ({ success: true }));
    const current = vi.fn(() => {
      if (!holdRead) return info;
      readEntered = true;
      return pendingRead;
    });
    const ui = mount(
      {
        apply: () => ({ ok: true }),
        selectionRequestGate: () => gate,
        whenSelectionRequestSettled: async () => {
          gate = 'open';
          return 'open';
        },
      },
      { selection: { current }, format: { bold } },
    );
    try {
      expect(await ui.commands.executeAsync('bold')).not.toBe(false);
      expect(bold).toHaveBeenCalledTimes(1);
      holdRead = true;
      gate = 'pending';
      const command = ui.commands.executeAsync('bold');
      await vi.waitFor(() => expect(readEntered).toBe(true));
      gate = 'pending';
      release(info);
      expect(await command).toBe(false);
      expect(bold).toHaveBeenCalledTimes(1);
    } finally {
      release(info);
      ui.destroy();
    }
  });
  it('places around a content control on the helper as receiver', async () => {
    const helper = new PrototypeSelectionTargets();
    expect(Object.getPrototypeOf(helper)).not.toBe(Object.prototype);
    const ui = mount(helper);

    try {
      await expect(ui.selection.placeAroundContentControl({ id: 'cc-1' })).resolves.toEqual({ ok: true });
      expect(helper.placed).toEqual([{ id: 'cc-1' }]);
    } finally {
      ui.destroy();
    }
  });

  it('reports the capability unavailable when the helper has no placement method', async () => {
    const ui = mount(new ApplyOnlySelectionTargets());

    try {
      await expect(ui.selection.placeAroundContentControl({ id: 'cc-1' })).resolves.toEqual({
        ok: false,
        reason: 'host-capability-unavailable',
      });
    } finally {
      ui.destroy();
    }
  });
});

it('refuses a pending collapsed selection when creating a comment', async () => {
  const point = { kind: 'text' as const, blockId: 'P1', offset: 0 };
  const target = { kind: 'selection' as const, start: point, end: point };
  const create = vi.fn();
  const ui = mount(
    {
      apply: () => ({ ok: true }),
      selectionRequestGate: () => 'pending',
      confirmedSelectionTarget: async () => ({ ok: true, mode: 'caret', target }),
    },
    { comments: { create } },
  );
  try {
    expect(await ui.comments.createFromSelection({ text: 'No range' })).toMatchObject({
      success: false,
      failure: { code: 'NO_SELECTION' },
    });
    expect(create).not.toHaveBeenCalled();
  } finally {
    ui.destroy();
  }
});
