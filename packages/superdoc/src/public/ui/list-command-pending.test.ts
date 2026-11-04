import { describe, expect, it, vi } from 'vite-plus/test';
import { createSuperDocUI } from './create-super-doc-ui.js';

function mount(waitForPaint = false) {
  let resolvePaint = () => {};
  let rejectPaint = (_reason: unknown) => {};
  const painted = new Promise<void>((resolve, reject) => {
    resolvePaint = resolve;
    rejectPaint = reject;
  });
  const whenPainted = vi.fn((_receipt?: unknown) => painted);
  let blockId = 'P1';
  let notifySelection = () => {};
  const pending: Array<(result: unknown) => void> = [];
  const sourceLists = new Map<string, { kind: string; preset: string }>();
  const apply = vi.fn(
    (raw: unknown) =>
      new Promise((resolve) =>
        pending.push((result) => {
          const input = raw as {
            kind: string;
            behavior: string;
            preset?: string;
            target: { start: { blockId: string } };
          };
          const target = input.target.start.blockId;
          const current = sourceLists.get(target);
          const preset = input.preset ?? (input.kind === 'bullet' ? 'disc' : 'decimal');
          if (
            current?.kind === input.kind &&
            (input.behavior === 'toggle' || (input.behavior === 'toggleStyle' && current.preset === preset))
          )
            sourceLists.delete(target);
          else sourceLists.set(target, { kind: input.kind, preset });
          resolve(result);
        }),
      ),
  );
  const current = () => ({
    empty: true,
    target: { kind: 'text', segments: [{ blockId, range: { start: 1, end: 1 } }] },
    activeMarks: [],
    activeCommentIds: [],
    activeChangeIds: [],
  });
  const superdoc = {
    activeEditor: {
      editorVersion: 2,
      ...(waitForPaint ? { documentMutationReadiness: { whenPainted } } : {}),
      host: {
        getHandles: () => ({
          editing: {
            selection: {
              subscribe: (listener: () => void) => {
                notifySelection = listener;
                return () => {};
              },
            },
          },
        }),
      },
      doc: {
        selection: { current },
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
      },
      editCommands: {
        lists: { apply },
        getSnapshot: () => ({
          commands: {
            'lists.apply': {
              enabled: true,
              active: sourceLists.has(blockId),
              value: { seed: sourceLists.get(blockId)?.kind ?? null },
              shippedStatus: 'supported',
            },
          },
        }),
      },
    },
    config: { documentMode: 'editing' },
    on: vi.fn(),
    off: vi.fn(),
  };
  const ui = createSuperDocUI({ superdoc: superdoc as never });
  return {
    ui,
    apply,
    pending,
    whenPainted,
    resolvePaint,
    rejectPaint,
    superdoc,
    source: (id = 'P1') => sourceLists.get(id),
    select(id: string) {
      blockId = id;
      notifySelection();
    },
  };
}

describe('pending list requests', () => {
  it('does not publish a request for an already retired optional host lifetime', async () => {
    const h = mount();
    try {
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
      const lifetime = new AbortController();
      lifetime.abort();
      Object.assign(h.superdoc.activeEditor.host, { getForegroundInteractionLifetime: () => lifetime.signal });
      vi.spyOn(h.superdoc.activeEditor.doc.selection, 'current').mockImplementationOnce(
        () => new Promise(() => {}) as never,
      );
      expect(await h.ui.commands.executeAsync('bullet-list')).toBe(false);
      expect(h.ui.commands.get('bullet-list').getState().pending).toBe(false);
      expect(h.apply).not.toHaveBeenCalled();
    } finally {
      h.ui.destroy();
      vi.restoreAllMocks();
    }
  });

  it('clears unrelated pending feedback when a delayed invocation scope resolves', async () => {
    const h = mount();
    try {
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
      const selection = h.superdoc.activeEditor.doc.selection;
      const captured = selection.current();
      let release!: (value: unknown) => void;
      vi.spyOn(selection, 'current').mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }) as never,
      );
      const request = h.ui.commands.executeAsync('bullet-list');
      h.select('P2');
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().target?.segments[0]?.blockId).toBe('P2'));
      expect(h.ui.commands.get('bullet-list').getState().pending).toBe(true);
      release(captured);
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
      expect((h.apply.mock.calls[0]![0] as { target: { start: { blockId: string } } }).target.start.blockId).toBe('P1');
      expect(h.ui.commands.get('bullet-list').getState().pending).toBe(false);
      h.pending.shift()!({ success: true, txId: 'scope-resolved' });
      expect(await request).toMatchObject({ success: true });
    } finally {
      h.pending.splice(0).forEach((resolve) => resolve({ success: true }));
      h.ui.destroy();
      vi.restoreAllMocks();
    }
  });

  it.each(['false', 'receipt', 'success'] as const)(
    'handles an earlier settled %s while the repeat selection is delayed',
    async (outcome) => {
      const h = mount();
      try {
        await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
        let releaseFirst!: (value: unknown) => void;
        h.apply.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirst = resolve;
            }),
        );
        const first = h.ui.commands.executeAsync('bullet-list');
        await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
        const selection = h.superdoc.activeEditor.doc.selection;
        const captured = selection.current();
        let releaseSelection!: (value: unknown) => void;
        const read = vi.spyOn(selection, 'current').mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseSelection = resolve;
            }) as never,
        );
        const repeat = h.ui.commands.executeAsync('bullet-list');
        expect(read).toHaveBeenCalledTimes(1);
        const result =
          outcome === 'receipt'
            ? { success: false, failure: { code: 'INVALID_TARGET', message: 'Target unavailable.' } }
            : outcome === 'success';
        releaseFirst(result);
        expect(await first).toEqual(result);
        releaseSelection(captured);
        if (outcome === 'success') {
          expect(await repeat).toBe(true);
          expect(h.apply).toHaveBeenCalledTimes(1);
        } else {
          await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(2));
          h.pending.shift()!({ success: true, txId: 'retry' });
          expect(await repeat).toMatchObject({ success: true });
          expect(h.source()).toEqual({ kind: 'bullet', preset: 'disc' });
        }
      } finally {
        h.pending.splice(0).forEach((resolve) => resolve({ success: true }));
        h.ui.destroy();
        vi.restoreAllMocks();
      }
    },
  );

  it('exposes pending state and coalesces a repeat until the first request settles', async () => {
    const h = mount();
    try {
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
      const first = h.ui.commands.executeAsync('bullet-list');
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
      expect(h.ui.commands.get('bullet-list').getState()).toMatchObject({ pending: true });
      const second = h.ui.commands.executeAsync('bullet-list');
      await Promise.resolve();
      await Promise.resolve();
      expect(h.apply).toHaveBeenCalledTimes(1);
      h.pending.shift()!({ status: 'committed' });
      expect(await first).toBe(true);
      expect(await second).toBe(true);
      expect(h.ui.commands.get('bullet-list').getState()).toMatchObject({ pending: false });
      const intentional = h.ui.commands.executeAsync('bullet-list');
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(2));
      h.pending.shift()!({ status: 'committed' });
      expect(await intentional).toBe(true);
    } finally {
      h.ui.destroy();
    }
  });

  it('keeps different paragraphs and list kinds independent while a request is pending', async () => {
    const h = mount();
    try {
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
      const first = h.ui.commands.executeAsync('bullet-list');
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
      h.select('P2');
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().target?.segments[0]?.blockId).toBe('P2'));
      const second = h.ui.commands.executeAsync('bullet-list');
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(2));
      const ordered = h.ui.commands.executeAsync('numbered-list');
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(3));
      expect(
        h.apply.mock.calls.map((call) => (call[0] as { target: { start: { blockId: string } } }).target.start.blockId),
      ).toEqual(['P1', 'P2', 'P2']);
      h.pending.splice(0).forEach((resolve) => resolve({ status: 'committed' }));
      expect(await Promise.all([first, second, ordered])).toEqual([true, true, true]);
    } finally {
      h.ui.destroy();
    }
  });

  it('retains pending protection until the committed bullet is painted', async () => {
    const h = mount(true);
    try {
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
      let settled = false;
      const first = h.ui.commands.executeAsync('bullet-list').then((result) => {
        settled = true;
        return result;
      });
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
      h.pending.shift()!({ status: 'committed' });
      await vi.waitFor(() => expect(h.whenPainted).toHaveBeenCalled());
      expect(settled).toBe(false);
      expect(h.ui.commands.get('bullet-list').getState()).toMatchObject({ pending: true });
      const repeat = h.ui.commands.executeAsync('bullet-list');
      await Promise.resolve();
      expect(h.apply).toHaveBeenCalledTimes(1);
      h.resolvePaint();
      expect(await first).toBe(true);
      expect(await repeat).toBe(true);
      expect(h.ui.commands.get('bullet-list').getState()).toMatchObject({ pending: false });
    } finally {
      h.resolvePaint();
      h.ui.destroy();
    }
  });
  it.each(['direct', 'nested'])('preserves the %s successful receipt through actual paint', async (shape) => {
    const h = mount(true);
    try {
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
      const request = h.ui.commands.executeAsync('bullet-list');
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
      const receipt = { success: true, txId: 'list-tx' };
      h.pending.shift()!(shape === 'nested' ? { receipt } : receipt);
      await vi.waitFor(() => expect(h.whenPainted).toHaveBeenCalledWith(receipt));
      expect(h.whenPainted.mock.calls[0]?.[0]).toBe(receipt);
      expect(h.ui.commands.get('bullet-list').getState().pending).toBe(true);
      h.resolvePaint();
      expect(await request).toEqual(shape === 'direct' ? receipt : true);
      expect(h.ui.commands.get('bullet-list').getState().pending).toBe(false);
    } finally {
      h.resolvePaint();
      h.ui.destroy();
    }
  });

  it.each(['failure', 'legacy'])('preserves %s command settlement while normalizing receipts', async (shape) => {
    const h = mount(true);
    try {
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
      const request = h.ui.commands.executeAsync('bullet-list');
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
      const failure = { success: false, failure: { code: 'INVALID_TARGET', message: 'Target unavailable.' } };
      h.pending.shift()!(shape === 'failure' ? failure : undefined);
      if (shape === 'failure') {
        expect(await request).toEqual(failure);
        expect(h.whenPainted).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() => expect(h.whenPainted).toHaveBeenCalledWith(undefined));
        expect(h.ui.commands.get('bullet-list').getState().pending).toBe(true);
        h.resolvePaint();
        expect(await request).toBe(true);
      }
      expect(h.ui.commands.get('bullet-list').getState().pending).toBe(false);
    } finally {
      h.resolvePaint();
      h.ui.destroy();
    }
  });

  it.each(['direct', 'nested'])('preserves the %s committed result when paint observation fails', async (shape) => {
    const h = mount(true);
    try {
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
      const request = h.ui.commands.executeAsync('bullet-list');
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
      const receipt = { success: true, txId: 'list-tx' };
      h.pending.shift()!(shape === 'nested' ? { receipt } : receipt);
      await vi.waitFor(() => expect(h.whenPainted).toHaveBeenCalledWith(receipt));
      h.rejectPaint(new Error('presentation failed'));
      expect(await request).toEqual(shape === 'direct' ? receipt : true);
      expect(h.source()).toEqual({ kind: 'bullet', preset: 'disc' });
      expect(h.ui.commands.get('bullet-list').getState().pending).toBe(false);
    } finally {
      h.ui.destroy();
    }
  });

  it('settles an outstanding presentation request when the UI is destroyed', async () => {
    const h = mount(true);
    await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
    const request = h.ui.commands.executeAsync('bullet-list');
    await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
    h.pending.shift()!({ success: true, txId: 'list-tx' });
    await vi.waitFor(() => expect(h.whenPainted).toHaveBeenCalled());
    h.ui.destroy();
    expect(await request).toBe(false);
    h.resolvePaint();
  });

  it('retires a request when selection moves to a replacement document', async () => {
    const h = mount(true);
    try {
      await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
      const request = h.ui.commands.executeAsync('bullet-list');
      await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
      h.pending.shift()!({ success: true, txId: 'old-document-tx' });
      await vi.waitFor(() => expect(h.whenPainted).toHaveBeenCalled());
      h.superdoc.activeEditor.doc = { ...h.superdoc.activeEditor.doc };
      h.select('P2');
      expect(await request).toBe(false);
      h.resolvePaint();
      expect(h.ui.commands.get('bullet-list').getState().pending).toBe(false);
    } finally {
      h.ui.destroy();
    }
  });

  it.each(['kind', 'preset'] as const)(
    'keeps the final %s intent after an intervening pending request',
    async (variant) => {
      const h = mount(true);
      try {
        await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
        const payload = variant === 'preset' ? { behavior: 'apply', preset: 'disc' } : undefined;
        const first = h.ui.commands.executeAsync('bullet-list', payload);
        await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1));
        const second =
          variant === 'kind'
            ? h.ui.commands.executeAsync('numbered-list')
            : h.ui.commands.executeAsync('bullet-list', { behavior: 'apply', preset: 'square' });
        await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(2));
        const final = h.ui.commands.executeAsync('bullet-list', payload);
        await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(3));
        h.pending.splice(0).forEach((resolve) => resolve({ status: 'committed' }));
        await vi.waitFor(() => expect(h.whenPainted).toHaveBeenCalled());
        expect(h.source()).toEqual({ kind: 'bullet', preset: 'disc' });
        expect(h.ui.commands.get('bullet-list').getState().pending).toBe(true);
        h.resolvePaint();
        expect(await Promise.all([first, second, final])).toEqual([true, true, true]);
      } finally {
        h.resolvePaint();
        h.ui.destroy();
      }
    },
  );
});

it.each(['mode', 'document'])('does not resume a canceled selection read after a %s round-trip', async (change) => {
  const h = mount();
  try {
    await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
    const doc = h.superdoc.activeEditor.doc;
    const original = doc.selection.current;
    let release!: (value: unknown) => void;
    vi.spyOn(doc.selection, 'current').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never,
    );
    const request = h.ui.commands.executeAsync('bullet-list');
    if (change === 'mode') h.superdoc.config.documentMode = 'viewing';
    else h.superdoc.activeEditor.doc = { ...doc, selection: { current: original } };
    h.select('P1');
    expect(await request).toBe(false);
    if (change === 'mode') h.superdoc.config.documentMode = 'editing';
    else h.superdoc.activeEditor.doc = doc;
    h.select('P1');
    release(original());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.apply).not.toHaveBeenCalled();
  } finally {
    h.pending.splice(0).forEach((resolve) => resolve({ status: 'committed' }));
    h.ui.destroy();
    vi.restoreAllMocks();
  }
});
