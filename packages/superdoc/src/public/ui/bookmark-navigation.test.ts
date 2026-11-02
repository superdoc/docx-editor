import { describe, expect, it, vi } from 'vite-plus/test';
import { createSuperDocUI } from './create-super-doc-ui.js';

const ADDRESS = { kind: 'entity', entityType: 'bookmark', name: 'Target' } as const;
const INFO = {
  address: ADDRESS,
  name: 'Target',
  bookmarkId: '1',
  range: { from: { blockId: 'P1', offset: 2 }, to: { blockId: 'P2', offset: 8 } },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mount() {
  const apply = vi.fn(() => ({ ok: true }));
  const scroll = vi.fn(async (_input: unknown) => ({ success: true }));
  const list = vi.fn(async () => ({ items: [INFO], total: 1 }));
  const get = vi.fn(async () => INFO);
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  const editor = {
    editorVersion: 2,
    doc: { bookmarks: { list, get } },
    host: { getHandles: () => ({ selection: { apply } }), scrollTargetIntoView: scroll },
  };
  const superdoc = {
    activeEditor: editor,
    on: (name: string, cb: (payload?: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(cb);
    },
    off: (name: string, cb: (payload?: unknown) => void) => listeners.get(name)?.delete(cb),
  };
  const ui = createSuperDocUI({ superdoc: superdoc as never });
  // Keep this test-only contract executable on the unfixed public surface.
  const navigate = (input: unknown, options?: unknown) => {
    const handle = (ui as any).bookmarks;
    expect(typeof handle?.navigateTo, 'public bookmark navigation must be callable').toBe('function');
    return handle.navigateTo(input, options);
  };
  return {
    ui,
    navigate,
    apply,
    scroll,
    list,
    get,
    editor,
    superdoc,
    emit: (event: string) => {
      for (const cb of listeners.get(event) ?? []) cb({ editor });
    },
  };
}

describe('public bookmark navigation', () => {
  it('reveals the exact start before applying the full multi-block range', async () => {
    const h = mount();
    expect(await h.navigate('Target')).toEqual({ success: true, ok: true });
    expect(h.scroll).toHaveBeenCalledWith(
      {
        target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 2, end: 2 } }] },
        block: 'center',
        behavior: 'instant',
      },
      expect.any(Function),
    );
    expect(h.apply).toHaveBeenCalledWith({
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 2 },
      end: { kind: 'text', blockId: 'P2', offset: 8 },
    });
    expect(h.scroll.mock.invocationCallOrder[0]).toBeLessThan(h.apply.mock.invocationCallOrder[0]);
    h.ui.destroy();
  });

  it('accepts a canonical explicit body address and scroll options', async () => {
    const h = mount();
    expect(
      await h.navigate(
        { ...ADDRESS, story: { kind: 'story', storyType: 'body' } },
        { block: 'start', behavior: 'auto' },
      ),
    ).toEqual({ success: true, ok: true });
    expect(h.list).toHaveBeenCalledWith({ in: { kind: 'story', storyType: 'body' } });
    expect(h.scroll.mock.calls[0][0]).toMatchObject({ block: 'start', behavior: 'auto' });
    h.ui.destroy();
  });

  for (const kind of [
    'missing',
    'ambiguous',
    'non-body',
    'non-body-string',
    'column',
    'invalid-range',
    'inverted-range',
    'text-offset',
  ] as const) {
    it(`fails closed for ${kind} without scrolling or applying a selection`, async () => {
      const h = mount();
      const items = kind === 'missing' ? [] : kind === 'ambiguous' ? [INFO, INFO] : [INFO];
      h.list.mockResolvedValue({ items, total: items.length });
      if (kind === 'non-body')
        h.get.mockResolvedValue({ ...INFO, address: { ...ADDRESS, story: { storyType: 'header' } } } as never);
      if (kind === 'non-body-string')
        h.get.mockResolvedValue({ ...INFO, address: { ...ADDRESS, story: 'header1' } } as never);
      if (kind === 'column') h.get.mockResolvedValue({ ...INFO, tableColumn: { colFirst: 0, colLast: 1 } } as never);
      if (kind === 'invalid-range')
        h.get.mockResolvedValue({ ...INFO, range: { from: { blockId: 'P1', offset: -1 }, to: INFO.range.to } });
      if (kind === 'inverted-range')
        h.get.mockResolvedValue({
          ...INFO,
          range: { from: { blockId: 'P1', offset: 5 }, to: { blockId: 'P1', offset: 2 } },
        });
      if (kind === 'text-offset')
        h.get.mockResolvedValue({
          ...INFO,
          range: { from: { blockId: 'P1', offset: '2' }, to: INFO.range.to },
        } as never);
      expect(await h.navigate('Target')).toEqual({ success: false, ok: false, reason: 'target-unresolved' });
      expect(h.scroll).not.toHaveBeenCalled();
      expect(h.apply).not.toHaveBeenCalled();
      h.ui.destroy();
    });
  }

  it('rejects malformed inputs and unsupported addresses before reads', async () => {
    const h = mount();
    for (const input of [
      null,
      '',
      {},
      { ...ADDRESS, story: { kind: 'story', storyType: 'header' } },
      { ...ADDRESS, kind: 'text' },
      { ...ADDRESS, story: {} },
    ]) {
      expect(await h.navigate(input)).toEqual({ success: false, ok: false, reason: 'target-unresolved' });
    }
    expect(h.list).not.toHaveBeenCalled();
    expect(h.apply).not.toHaveBeenCalled();
    h.ui.destroy();
  });

  for (const change of ['editor', 'document', 'dispose'] as const) {
    it(`abandons async lookup after ${change} changes`, async () => {
      const h = mount();
      const pending = deferred<{ items: (typeof INFO)[]; total: number }>();
      h.list.mockReturnValue(pending.promise);
      const result = h.navigate('Target');
      if (change === 'editor') h.superdoc.activeEditor = { ...h.editor, doc: { ...h.editor.doc } };
      if (change === 'document') h.emit('document-replaced');
      if (change === 'dispose') h.ui.destroy();
      pending.resolve({ items: [INFO], total: 1 });
      expect(await result).toMatchObject({ success: false, ok: false });
      expect(h.scroll).not.toHaveBeenCalled();
      expect(h.apply).not.toHaveBeenCalled();
      h.ui.destroy();
    });
  }

  it('abandons superseded navigation and a document replaced during reveal', async () => {
    const h = mount();
    const pending = deferred<{ success: boolean }>();
    h.scroll.mockReturnValueOnce(pending.promise);
    const first = h.navigate('Target');
    await vi.waitFor(() => expect(h.scroll).toHaveBeenCalledTimes(1));
    expect(await h.navigate('Target')).toEqual({ success: true, ok: true });
    pending.resolve({ success: true });
    expect(await first).toMatchObject({ success: false, ok: false });
    expect(h.apply).toHaveBeenCalledTimes(1);
    const replacement = deferred<{ success: boolean }>();
    h.scroll.mockReturnValueOnce(replacement.promise);
    const result = h.navigate('Target');
    await vi.waitFor(() => expect(h.scroll).toHaveBeenCalledTimes(3));
    h.emit('document-replaced');
    replacement.resolve({ success: true });
    expect(await result).toMatchObject({ success: false, ok: false });
    expect(h.apply).toHaveBeenCalledTimes(1);
    h.ui.destroy();
  });

  it('preserves the selection when painted reveal fails', async () => {
    const h = mount();
    h.scroll.mockResolvedValue({ success: false, reason: 'target-not-visible' } as never);
    expect(await h.navigate('Target')).toEqual({ success: false, ok: false, reason: 'target-not-visible' });
    expect(h.apply).not.toHaveBeenCalled();
    h.ui.destroy();
  });
});
