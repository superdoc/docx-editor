import { describe, expect, it, vi } from 'vite-plus/test';
import { createContentControlsHandle, type ContentControlsHandleDeps } from './content-controls-handle.js';
import { SUPERDOC_UI_REASONS } from './reasons.js';
import type {
  ContentControlInfo,
  ContentControlsSlice,
  SelectionTarget,
  SnapshotSubscribable,
  Subscribable,
  SuperDocUIState,
  ViewportRectResult,
  WorkflowActionResult,
  WorkflowScrollResult,
} from './types.js';

const caretless: SelectionTarget = {
  kind: 'selection',
  start: { kind: 'text', blockId: 'p1', offset: 2 },
  end: { kind: 'text', blockId: 'p1', offset: 6 },
};

function control(id: string, overrides: Partial<ContentControlInfo> = {}): ContentControlInfo {
  return {
    nodeType: 'sdt',
    kind: 'inline',
    id,
    controlType: 'text',
    lockMode: 'unlocked',
    properties: {},
    target: { kind: 'inline', nodeType: 'sdt', nodeId: id },
    selectionTarget: caretless,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setup(items: ContentControlInfo[] = [control('cc-1')], catalog: unknown = { items }) {
  const slice: ContentControlsSlice = { status: 'ready', items, total: items.length, activeId: null, activeIds: [] };
  const select = (
    selector: (s: Pick<SuperDocUIState, 'contentControls'>) => ContentControlsSlice,
  ): Subscribable<ContentControlsSlice> => ({
    get: () => selector({ contentControls: slice }),
    subscribe: () => () => {},
  });
  const snapshotHandle = (sub: Subscribable<ContentControlsSlice>): SnapshotSubscribable<ContentControlsSlice> => ({
    get: () => sub.get(),
    getSnapshot: () => sub.get(),
    observe: (listener) => {
      listener(sub.get());
      return () => {};
    },
    subscribe: (listener) => {
      listener({ snapshot: sub.get() });
      return () => {};
    },
  });
  const leased: Subscribable<ContentControlsSlice>[] = [];
  const events = new Map<string, (payload: unknown) => void>();
  const host = {
    highlightContentControl: vi.fn(async () => true),
    clearContentControlHighlight: vi.fn(),
    cancelContentControlHighlightRequest: vi.fn(),
    mountedFocus: vi.fn(),
    getMountedHandle: vi.fn(() => ({ focus: { focus: host.mountedFocus } })),
  };
  const editor: Record<string, unknown> = { host };
  const env: {
    disposed: boolean;
    leaseHeld: boolean;
    editor: Record<string, unknown> | null;
    host: Record<string, unknown> | null;
  } = { disposed: false, leaseHeld: false, editor, host };
  const resetHooks: Array<() => void> = [];
  const detachers: Array<() => void> = [];
  const superdoc = {
    on: vi.fn((name: string, handler: (payload: unknown) => void) => events.set(name, handler)),
    off: vi.fn((name: string) => events.delete(name)),
  };
  const deps = {
    superdoc,
    select,
    snapshotHandle,
    leasedDirectorySnapshot: (passive, directory) => {
      leased.push(directory);
      return snapshotHandle(passive);
    },
    directoryLeaseHeld: () => env.leaseHeld,
    demandCatalog: vi.fn(),
    isDisposed: () => env.disposed,
    currentEditor: () => env.editor,
    currentHost: () => env.host,
    documentContentControls: () => ({ list: async () => catalog }),
    rectOf: vi.fn((): ViewportRectResult => ({ found: true, success: true, rects: [] })),
    scrollIntoView: vi.fn(async (): Promise<WorkflowScrollResult> => ({ success: true, ok: true })),
    applySelection: vi.fn((): WorkflowActionResult => ({ ok: true })),
    activateChrome: vi.fn(),
    onDocumentReset: (hook) => resetHooks.push(hook),
    onDestroy: (detach) => detachers.push(detach),
  } satisfies ContentControlsHandleDeps;
  const controller = createContentControlsHandle(deps);
  return { ...controller, deps, env, host, editor, events, superdoc, leased, resetHooks, detachers };
}

describe('content-controls handle', () => {
  it('renews catalog demand from the directory selector only while a lease is held', () => {
    const { deps, env, leased } = setup();
    leased[0]?.get();
    expect(deps.demandCatalog).not.toHaveBeenCalled();
    env.leaseHeld = true;
    leased[0]?.get();
    expect(deps.demandCatalog).toHaveBeenCalledTimes(1);
  });

  it('reads the snapshot passively and demands the catalog for keyed reads', () => {
    const { handle, deps } = setup();
    expect(handle.get().items).toHaveLength(1);
    expect(handle.observeActivePath(() => {})).toBeTypeOf('function');
    expect(deps.demandCatalog).not.toHaveBeenCalled();
    expect(handle.get({ id: 'cc-1' })?.id).toBe('cc-1');
    expect(handle.get({ id: '' })).toBeNull();
    expect(handle.getById('missing')).toBeNull();
    expect(handle.list()).toHaveLength(1);
    expect(deps.demandCatalog).toHaveBeenCalledTimes(4);
  });

  it('resolves rects and scrolls through the control anchor, failing closed without one', async () => {
    const { handle, deps } = setup([control('cc-1'), control('cc-bare', { selectionTarget: null })]);
    expect(handle.getRect({ id: '' })).toMatchObject({ success: false, reason: 'unresolved' });
    expect(deps.demandCatalog).not.toHaveBeenCalled();
    expect(handle.getRect({ id: 'missing' })).toMatchObject({ reason: 'unresolved' });
    expect(handle.getRect({ id: 'cc-bare' })).toMatchObject({ reason: 'unavailable' });
    expect(handle.getRect({ id: 'cc-1' })).toMatchObject({ success: true });
    expect(deps.rectOf).toHaveBeenCalledWith(caretless);
    expect(await handle.scrollIntoView({ id: 'cc-bare' })).toEqual({ success: false });
    expect(await handle.scrollIntoView({ id: 'cc-1', block: 'start' })).toEqual({ success: true });
    expect(deps.scrollIntoView).toHaveBeenLastCalledWith(caretless, { block: 'start', behavior: undefined });
  });

  it('highlights a reachable control and reports each failure reason', async () => {
    const { handle, host, env } = setup([control('cc-1'), control('cc-empty', { isEmpty: true })]);
    expect(await handle.highlight({ id: '' })).toEqual({ success: false, reason: 'invalid-id' });
    expect(await handle.highlight({ id: 'missing' })).toEqual({ success: false, reason: 'not-found' });
    expect(await handle.highlight({ id: 'cc-empty' })).toEqual({ success: false, reason: 'not-reachable' });
    expect(await handle.highlight({ id: 'cc-1' })).toEqual({ success: true });
    expect(host.highlightContentControl).toHaveBeenLastCalledWith('cc-1', caretless);
    host.highlightContentControl.mockResolvedValueOnce(false);
    expect(await handle.highlight({ id: 'cc-1' })).toEqual({ success: false, reason: 'not-reachable' });
    env.host = null;
    expect(await handle.highlight({ id: 'cc-1' })).toEqual({ success: false, reason: 'not-ready' });
  });

  it('treats a malformed catalog as unreachable and a catalog without items as not found', async () => {
    for (const [catalog, reason] of [
      [{ items: 'cc-1' }, 'not-reachable'],
      [{ items: [null, { id: 'cc-1' }] }, 'not-reachable'],
      [{ items: ['cc-1', { id: 'cc-1', selectionTarget: caretless }] }, undefined],
      [
        {
          items: {
            find: (match: (row: unknown) => boolean) => [{ id: 'cc-1', selectionTarget: caretless }].find(match),
          },
        },
        undefined,
      ],
      [{}, 'not-found'],
      [null, 'not-found'],
    ] as const) {
      const { handle } = setup(undefined, catalog);
      expect(await handle.highlight({ id: 'cc-1' })).toEqual(reason ? { success: false, reason } : { success: true });
    }
  });

  it('cancels a highlight superseded by clearing, a newer request, an editor change, or disposal', async () => {
    const { handle, host, env, resetHooks } = setup();
    for (const supersede of [
      () => handle.clearHighlight(),
      () => handle.highlight({ id: 'cc-1' }),
      () => {
        env.editor = { host };
      },
      () => {
        env.disposed = true;
      },
    ]) {
      const paint = deferred<boolean>();
      host.highlightContentControl.mockReturnValueOnce(paint.promise);
      const pending = handle.highlight({ id: 'cc-1' });
      await vi.waitFor(() => expect(host.highlightContentControl).toHaveBeenCalled());
      const newer = supersede();
      paint.resolve(true);
      expect(await pending).toEqual({ success: false, reason: 'cancelled' });
      await newer;
      host.highlightContentControl.mockClear();
    }
    expect(resetHooks).toHaveLength(1);
    expect(host.cancelContentControlHighlightRequest).toHaveBeenCalled();
    expect(host.clearContentControlHighlight).toHaveBeenCalledTimes(1);
  });

  it('gives teardown a clear that a consumer reassigning the handle method cannot replace', () => {
    const { handle, host, clearHighlight } = setup();
    handle.clearHighlight = () => {};
    clearHighlight();
    expect(host.clearContentControlHighlight).toHaveBeenCalledTimes(1);
  });

  it('requires a catalog row to be an object before reading its anchor', () => {
    const callableRow = Object.assign(() => {}, { id: 'cc-1', selectionTarget: caretless });
    const { handle, deps } = setup([Object.assign(callableRow, control('cc-1'))]);
    expect(handle.getRect({ id: 'cc-1' })).toMatchObject({ reason: 'unavailable' });
    expect(deps.rectOf).not.toHaveBeenCalled();
  });

  it('reads the selection start once when collapsing the caret', async () => {
    let reads = 0;
    const target = {
      kind: 'selection' as const,
      end: caretless.end,
      get start() {
        reads += 1;
        return caretless.start;
      },
    };
    const { handle, deps } = setup([control('cc-1', { selectionTarget: target })]);
    expect(await handle.focus({ id: 'cc-1' })).toEqual({ success: true });
    expect(deps.applySelection).toHaveBeenCalledWith(expect.objectContaining({ end: caretless.start }));
    expect(reads).toBe(2);
  });

  it('reads whenPainted again when calling it, so a getter that drops it fails closed', async () => {
    const { handle, deps, editor } = setup();
    let reads = 0;
    editor.documentMutationReadiness = {
      get whenPainted() {
        reads += 1;
        return reads === 1 ? async () => {} : undefined;
      },
    };
    expect(await handle.focus({ id: 'cc-1' })).toEqual({ success: false, reason: 'not-reachable' });
    expect(deps.activateChrome).not.toHaveBeenCalled();
  });

  it('clears the highlight on the host that painted it', async () => {
    const { handle, host, env } = setup();
    await handle.highlight({ id: 'cc-1' });
    const replacement = { clearContentControlHighlight: vi.fn() };
    env.host = replacement;
    handle.clearHighlight();
    expect(host.clearContentControlHighlight).toHaveBeenCalledTimes(1);
    handle.clearHighlight();
    expect(replacement.clearContentControlHighlight).toHaveBeenCalledTimes(1);
  });

  it('forwards valid click payloads, isolates listener errors, and detaches on destroy', () => {
    const { handle, events, superdoc, detachers, env, clearClickListeners } = setup();
    const received = vi.fn();
    handle.onClick(() => {
      throw new Error('listener failure');
    });
    const stop = handle.onClick(received);
    const click = events.get('content-control:click');
    const payload = { source: 'pointer', target: { id: 'cc-1', controlType: 'text', scope: 'inline' } };
    click?.({ source: 'keyboard' });
    click?.(payload);
    expect(received).toHaveBeenCalledExactlyOnceWith(payload);
    stop();
    click?.(payload);
    expect(received).toHaveBeenCalledTimes(1);
    handle.onClick(received);
    clearClickListeners();
    click?.(payload);
    expect(received).toHaveBeenCalledTimes(1);
    env.disposed = true;
    const late = vi.fn();
    handle.onClick(late);
    click?.(payload);
    expect(late).not.toHaveBeenCalled();
    for (const detach of detachers) detach();
    expect(superdoc.off).toHaveBeenCalledWith('content-control:click', click);
  });

  it('reads the selection target once and never touches the catalog after disposal', async () => {
    let reads = 0;
    const flaky = {
      id: 'cc-1',
      get selectionTarget() {
        reads += 1;
        return reads === 1 ? caretless : null;
      },
    };
    const single = setup(undefined, { items: [flaky] });
    expect(await single.handle.highlight({ id: 'cc-1' })).toEqual({ success: true });
    expect(reads).toBe(1);
    expect(single.host.highlightContentControl).toHaveBeenCalledWith('cc-1', caretless);
    const { handle, deps, env } = setup();
    const listRead = vi.fn();
    const throwingList: ContentControlsHandleDeps = {
      ...deps,
      documentContentControls: () => ({
        get list() {
          listRead();
          throw new Error('list getter');
        },
      }),
    };
    env.disposed = true;
    expect(await createContentControlsHandle(throwingList).handle.highlight({ id: 'cc-1' })).toEqual({
      success: false,
      reason: 'not-ready',
    });
    expect(listRead).not.toHaveBeenCalled();
    handle.clearHighlight();
  });

  it('focuses by scrolling, placing a collapsed caret, waiting for paint, then focusing the mount', async () => {
    const { handle, deps, editor, host } = setup();
    const order: string[] = [];
    let painted = () => {};
    const whenPainted = vi.fn(() => new Promise<void>((resolve) => (painted = resolve)));
    editor.documentMutationReadiness = { whenPainted };
    vi.mocked(deps.scrollIntoView).mockImplementation(async () => {
      order.push('scroll');
      return { success: true, ok: true };
    });
    vi.mocked(deps.applySelection).mockImplementation(() => {
      order.push('caret');
      return { ok: true };
    });
    host.mountedFocus.mockImplementation(() => order.push('focus'));
    vi.mocked(deps.activateChrome).mockImplementation(() => order.push('chrome'));
    const pending = handle.focus({ id: 'cc-1' });
    await vi.waitFor(() => expect(whenPainted).toHaveBeenCalled());
    expect(order).toEqual(['scroll', 'caret']);
    painted();
    expect(await pending).toEqual({ success: true });
    expect(order).toEqual(['scroll', 'caret', 'focus', 'chrome']);
  });

  it('tolerates a host without selection application and focuses without scrolling the page', async () => {
    const { handle, deps, editor, host } = setup();
    const whenPainted = vi.fn(async () => {});
    editor.documentMutationReadiness = { whenPainted };
    vi.mocked(deps.applySelection).mockReturnValueOnce({
      ok: false,
      reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable,
    });
    expect(await handle.focus({ id: 'cc-1' })).toEqual({ success: true });
    expect(deps.applySelection).toHaveBeenCalledWith({ ...caretless, end: caretless.start });
    expect(whenPainted).toHaveBeenCalled();
    expect(host.mountedFocus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(deps.activateChrome).toHaveBeenCalledWith('cc-1');
  });

  it('reports focus failures without activating chrome', async () => {
    const { handle, deps, env, editor, host } = setup([control('cc-1'), control('cc-bare', { selectionTarget: null })]);
    expect(await handle.focus({ id: '' })).toEqual({ success: false, reason: 'invalid-id' });
    expect(await handle.focus({ id: 'missing' })).toEqual({ success: false, reason: 'not-found' });
    expect(await handle.focus({ id: 'cc-bare' })).toEqual({ success: false, reason: 'not-reachable' });
    vi.mocked(deps.applySelection).mockReturnValueOnce({ ok: false, reason: SUPERDOC_UI_REASONS.notReady });
    expect(await handle.focus({ id: 'cc-1' })).toEqual({ success: false, reason: 'not-reachable' });
    editor.documentMutationReadiness = {
      whenPainted: async () => {
        env.editor = { host };
      },
    };
    expect(await handle.focus({ id: 'cc-1' })).toEqual({ success: false, reason: 'not-ready' });
    env.editor = null;
    expect(await handle.focus({ id: 'cc-1' })).toEqual({ success: false, reason: 'not-ready' });
    expect(deps.activateChrome).not.toHaveBeenCalled();
  });
});
