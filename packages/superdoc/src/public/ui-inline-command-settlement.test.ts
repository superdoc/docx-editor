import { describe, expect, it, vi } from 'vite-plus/test';
import { createSuperDocUI } from './ui.js';

const selection = {
  empty: false,
  target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 5 } }] },
  selectionTarget: {
    kind: 'selection',
    start: { kind: 'text', blockId: 'P1', offset: 0 },
    end: { kind: 'text', blockId: 'P1', offset: 5 },
  },
  activeMarks: [],
  activeCommentIds: [],
  activeChangeIds: [],
  text: 'hello',
};

function uniform(active: boolean) {
  return { success: true, values: { bold: { state: 'uniform', value: String(active) } } };
}

function setup() {
  const pendingReads: Array<{ resolve(value: unknown): void; reject(error: Error): void }> = [];
  const readEffectiveInlineUniformity = vi.fn(
    () => new Promise((resolve, reject) => pendingReads.push({ resolve, reject })),
  );
  const receipt = { success: true, txId: 'bold-1' };
  const bold = vi.fn(async (): Promise<unknown> => receipt);
  const publicListeners = new Map<string, (...args: unknown[]) => void>();
  let sourceListener = (_event: Record<string, unknown>) => {};
  let selectionListener = (_selection: unknown) => {};
  const host = {
    getHandles: () => ({
      editing: {
        selection: {
          subscribe: (listener: typeof selectionListener) => {
            selectionListener = listener;
            return vi.fn();
          },
        },
      },
    }),
    events: {
      subscribe: (listener: typeof sourceListener) => {
        sourceListener = listener;
        return vi.fn();
      },
    },
  };
  const doc = {
    selection: { current: () => selection },
    comments: { list: () => ({ items: [] }) },
    trackChanges: { list: () => ({ items: [] }) },
    format: { bold, readEffectiveInlineUniformity },
  };
  const superdoc = {
    activeEditor: {
      host,
      documentMutationReadiness: { whenPainted: vi.fn(async () => undefined) },
      doc,
    },
    config: { documentMode: 'editing' },
    on: (name: string, listener: (...args: unknown[]) => void) => publicListeners.set(name, listener),
    off: vi.fn(),
  };
  const ui = createSuperDocUI({ superdoc });
  return {
    ui,
    superdoc,
    receipt,
    bold,
    pendingReads,
    readEffectiveInlineUniformity,
    emit: (name: string, ...args: unknown[]) => publicListeners.get(name)?.(...args),
    mutateSource: () => sourceListener({ type: 'document:mutated' }),
    moveSelection: () => selectionListener(superdoc.activeEditor.doc.selection.current()),
    async seed(active: boolean) {
      pendingReads[0]?.resolve(uniform(active));
      await vi.waitFor(() => expect(ui.commands.get('bold').getState().active).toBe(active));
    },
  };
}

describe('inline command state settlement', () => {
  it.each([false, true])(
    'keeps the committed toggle from %s while the current effective-mark read is pending',
    async (initial) => {
      const fixture = setup();
      const { ui, pendingReads } = fixture;
      const observed: boolean[] = [];
      const stop = ui.commands.get('bold').observe((state) => observed.push(state.active));
      try {
        await fixture.seed(initial);
        observed.length = 0;
        await expect(ui.commands.executeAsync('bold')).resolves.toBe(fixture.receipt);
        expect(fixture.bold).toHaveBeenCalledWith(
          { target: selection.selectionTarget, value: !initial },
          { offsetSpace: 'kernel' },
        );
        expect(fixture.readEffectiveInlineUniformity).toHaveBeenCalledTimes(2);
        expect(ui.commands.get('bold').getState().active).toBe(!initial);
        expect(observed).not.toContain(initial);
        pendingReads[1]?.resolve(uniform(!initial));
        await vi.waitFor(() => expect(ui.commands.get('bold').getState().active).toBe(!initial));
        expect(observed).not.toContain(initial);
      } finally {
        stop();
        ui.destroy();
      }
    },
  );

  it.each([
    ['false', uniform(false)],
    ['mixed', { success: true, values: { bold: { state: 'mixed' } } }],
    ['unresolved', { success: false }],
  ])('hands off to an authoritative current %s verdict', async (_name, verdict) => {
    const fixture = setup();
    try {
      await fixture.seed(false);
      await fixture.ui.commands.executeAsync('bold');
      expect(fixture.ui.commands.get('bold').getState().active).toBe(true);
      fixture.pendingReads[1]?.resolve(verdict);
      await vi.waitFor(() => expect(fixture.ui.commands.get('bold').getState().active).toBe(false));
    } finally {
      fixture.ui.destroy();
    }
  });

  it('does not mask a failed current formatting read', async () => {
    const fixture = setup();
    try {
      await fixture.seed(false);
      await fixture.ui.commands.executeAsync('bold');
      expect(fixture.ui.commands.get('bold').getState().active).toBe(true);
      fixture.pendingReads[1]?.reject(new Error('worker formatting read failed'));
      await vi.waitFor(() => expect(fixture.ui.commands.get('bold').getState().active).toBe(false));
    } finally {
      fixture.ui.destroy();
    }
  });

  it('does not carry a settled toggle into a later actual source mutation', async () => {
    const fixture = setup();
    try {
      await fixture.seed(false);
      await fixture.ui.commands.executeAsync('bold');
      expect(fixture.ui.commands.get('bold').getState().active).toBe(true);
      fixture.mutateSource();
      expect(fixture.ui.commands.get('bold').getState().active).toBe(false);
      await vi.waitFor(() => expect(fixture.readEffectiveInlineUniformity.mock.calls.length).toBeGreaterThan(2));
      fixture.pendingReads[1]?.resolve(uniform(true));
      await Promise.resolve();
      expect(fixture.ui.commands.get('bold').getState().active).toBe(false);
      fixture.pendingReads.at(-1)?.resolve(uniform(false));
      await vi.waitFor(() => expect(fixture.ui.commands.get('bold').getState().active).toBe(false));
    } finally {
      fixture.ui.destroy();
    }
  });

  it.each(['selection', 'mode', 'document', 'editor', 'replacement'] as const)(
    'cancels the held value when its %s ownership changes',
    async (change) => {
      const fixture = setup();
      try {
        await fixture.seed(false);
        await fixture.ui.commands.executeAsync('bold');
        expect(fixture.ui.commands.get('bold').getState().active).toBe(true);
        if (change === 'selection') {
          fixture.superdoc.activeEditor.doc.selection.current = () => ({
            ...selection,
            target: { kind: 'text', segments: [{ blockId: 'P2', range: { start: 0, end: 5 } }] },
            selectionTarget: {
              kind: 'selection',
              start: { kind: 'text', blockId: 'P2', offset: 0 },
              end: { kind: 'text', blockId: 'P2', offset: 5 },
            },
          });
          fixture.moveSelection();
        } else if (change === 'mode') {
          fixture.superdoc.config.documentMode = 'viewing';
          fixture.emit('document-mode-change');
        } else if (change === 'document') {
          fixture.superdoc.activeEditor.doc = { ...fixture.superdoc.activeEditor.doc };
          fixture.emit('editorCreate');
        } else if (change === 'editor') {
          fixture.superdoc.activeEditor = { ...fixture.superdoc.activeEditor };
          fixture.emit('active-editor-change');
        } else {
          fixture.emit('document-replaced', { editor: fixture.superdoc.activeEditor });
        }
        expect(fixture.ui.commands.get('bold').getState().active).toBe(false);
        fixture.pendingReads[1]?.resolve(uniform(false));
        await Promise.resolve();
        expect(fixture.ui.commands.get('bold').getState().active).toBe(false);
      } finally {
        fixture.ui.destroy();
      }
    },
  );

  it('rolls back a rejected mutation without waiting for a formatting read', async () => {
    const fixture = setup();
    try {
      await fixture.seed(false);
      fixture.bold.mockResolvedValueOnce({ success: false });
      await expect(fixture.ui.commands.executeAsync('bold')).resolves.toEqual({ success: false });
      expect(fixture.ui.commands.get('bold').getState().active).toBe(false);
    } finally {
      fixture.ui.destroy();
    }
  });

  it('does not publish a late formatting result after disposal', async () => {
    const fixture = setup();
    await fixture.seed(false);
    await fixture.ui.commands.executeAsync('bold');
    const observed = vi.fn();
    fixture.ui.commands.get('bold').observe(observed);
    fixture.ui.destroy();
    observed.mockClear();
    fixture.pendingReads[1]?.resolve(uniform(true));
    await Promise.resolve();
    await Promise.resolve();
    expect(observed).not.toHaveBeenCalled();
  });
});
