import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createSearchHandle, SEARCH_REFRESH_DELAY_MS, type SearchCommandState } from './search-handle.js';
import { SUPERDOC_UI_REASONS } from './reasons.js';
import type { SearchSnapshot, SnapshotSubscribable, Subscribable } from './types.js';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function snapshotHandle(sub: Subscribable<SearchSnapshot>): SnapshotSubscribable<SearchSnapshot> {
  return {
    get: () => sub.get(),
    getSnapshot: () => sub.get(),
    observe: (listener) => sub.subscribe(listener),
    subscribe: (listener) => sub.subscribe((snapshot) => listener({ snapshot })),
  };
}

function setup() {
  const env: {
    hostSearch: unknown;
    editSearch: unknown;
    commands: Partial<Record<'find.replace' | 'find.replaceAll', SearchCommandState>>;
    disposed: boolean;
  } = { hostSearch: null, editSearch: null, commands: {}, disposed: false };
  const resetHooks: Array<() => void> = [];
  const modeHooks: Array<() => void> = [];
  const controller = createSearchHandle({
    hostSearch: () => env.hostSearch,
    editCommandSearch: () => env.editSearch,
    editCommandState: (id) => env.commands[id] ?? null,
    snapshotHandle,
    isDisposed: () => env.disposed,
    onDocumentReset: (hook) => resetHooks.push(hook),
    onDocumentModeChange: (hook) => modeHooks.push(hook),
  });
  const emitted: SearchSnapshot[] = [];
  controller.handle.observe((snapshot) => emitted.push({ ...snapshot }));
  return { env, controller, search: controller.handle, resetHooks, modeHooks, emitted };
}

function hostSession(state: Record<string, unknown> = { query: 'a', total: 2, activeMatchIndex: 0, canReplace: true }) {
  let current: Record<string, unknown> | null = null;
  const move = (activeMatchIndex: number) => {
    current = current ? { ...current, activeMatchIndex } : null;
    return current;
  };
  return {
    setSession: vi.fn(() => {
      current = state;
      return current;
    }),
    getState: vi.fn(() => current),
    next: vi.fn(() => move(1)),
    previous: vi.fn(() => move(0)),
    clear: vi.fn(() => {
      current = null;
    }),
    replaceCurrent: vi.fn((): unknown => ({ status: 'committed' })),
    replaceAll: vi.fn((): unknown => ({ status: 'committed' })),
    refresh: vi.fn((): unknown => current),
  };
}

function shellSearch(result: (query: string) => unknown) {
  let current: unknown = null;
  return {
    query: vi.fn((input: { query: string }): unknown => {
      const answer = result(input.query);
      if (input.query === '') current = null;
      else if (!(answer instanceof Promise)) current = answer;
      else void answer.then((settled) => (current = settled));
      return answer;
    }),
    getState: vi.fn(() => current),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createSearchHandle', () => {
  it('registers one document-reset hook and one mode-change hook', () => {
    const { resetHooks, modeHooks } = setup();
    expect(resetHooks).toHaveLength(1);
    expect(modeHooks).toHaveLength(1);
  });

  it('fails closed when neither facade can search', () => {
    const { search } = setup();
    expect(search.getSnapshot()).toMatchObject({ available: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
    expect(search.open()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
    expect(search.find('a')).toMatchObject({ query: 'a', total: 0, available: false });
    expect(search.next()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
    expect(search.replace('b')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
  });

  it('drives a host session and releases it on close', () => {
    const { env, search } = setup();
    const host = hostSession();
    env.hostSearch = host;
    expect(search.find('a', { caseSensitive: true, regex: true })).toMatchObject({
      query: 'a',
      total: 2,
      activeIndex: 0,
      open: true,
      available: true,
      canReplace: true,
      canReplaceAll: true,
      caseSensitive: true,
      regex: true,
    });
    expect(host.setSession).toHaveBeenCalledWith('a', {
      caseSensitive: true,
      includeDeletedText: false,
      regex: true,
      highlight: true,
    });
    expect(search.next()).toEqual({ ok: true });
    expect(search.getSnapshot().activeIndex).toBe(1);
    expect(search.previous()).toEqual({ ok: true });
    expect(search.getSnapshot().activeIndex).toBe(0);
    search.close();
    expect(host.clear).toHaveBeenCalledOnce();
    expect(search.getSnapshot()).toMatchObject({ open: false, total: 0, available: true, reason: undefined });
  });

  it('keeps a session whose host reports a query open after close', () => {
    const { env, search } = setup();
    const state = { query: 'still-painted', total: 1 };
    env.hostSearch = { setSession: vi.fn(() => state), getState: vi.fn(() => state), clear: vi.fn() };
    search.find('a');
    search.close();
    expect(search.getSnapshot()).toMatchObject({ query: 'still-painted', open: true });
  });

  it('routes the deprecated search alias through the current find', () => {
    const { search } = setup();
    const find = vi.fn(() => search.getSnapshot());
    search.find = find;
    search.search('x');
    expect(find).toHaveBeenCalledWith('x', undefined);
  });

  it('withholds replace-all from truncated or empty host sessions', () => {
    const { env, search } = setup();
    env.hostSearch = hostSession({ total: 3, canReplace: true, truncated: true });
    expect(search.find('a')).toMatchObject({ canReplace: true, canReplaceAll: false });
    env.hostSearch = hostSession({ total: 0, canReplace: true });
    expect(search.find('b')).toMatchObject({ canReplace: true, canReplaceAll: false });
  });

  it('reports an invalid pattern without marking search unavailable', () => {
    const { env, search } = setup();
    env.hostSearch = hostSession({ total: 0, queryError: { code: 'invalid-pattern' } });
    expect(search.find('(')).toMatchObject({ available: true, reason: SUPERDOC_UI_REASONS.searchInvalidPattern });
  });

  it('maps host replace outcomes to stable reasons', async () => {
    const { env, search } = setup();
    const host = hostSession();
    env.hostSearch = host;
    search.find('a');
    const outcomes: Array<[unknown, unknown]> = [
      [{ status: 'committed' }, { ok: true }],
      [
        { status: 'rejected', reason: 'read-only' },
        { ok: false, reason: SUPERDOC_UI_REASONS.documentReadonly },
      ],
      [
        { status: 'rejected', rejection: { code: 'read-only-document' } },
        { ok: false, reason: SUPERDOC_UI_REASONS.documentReadonly },
      ],
      [
        { status: 'rejected', reason: 'truncated' },
        { ok: false, reason: SUPERDOC_UI_REASONS.searchTruncated },
      ],
      [
        { status: 'receipt-failure', failure: { code: 'REVISION_MISMATCH' } },
        { ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved },
      ],
      [null, { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable }],
    ];
    for (const [raw, expected] of outcomes) {
      host.replaceCurrent.mockReturnValueOnce(raw);
      expect(search.replace('b')).toEqual(expected);
    }
    host.replaceAll.mockReturnValueOnce(Promise.resolve({ status: 'committed' }));
    expect(await search.replaceAll('b')).toEqual({ ok: true });
    const emitted: SearchSnapshot[] = [];
    search.observe((snapshot) => emitted.push({ ...snapshot }));
    host.replaceAll.mockReturnValueOnce(Promise.reject(new Error('boom')));
    expect(await search.replaceAll('b')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
    expect(emitted.at(-1)).toMatchObject({ available: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
  });

  it('publishes nothing from the shell until its own fallback query settles', async () => {
    const { env, search } = setup();
    const pending = deferred<unknown>();
    const editSearch = shellSearch(() => pending.promise);
    env.editSearch = editSearch;
    env.commands['find.replace'] = { enabled: true };
    expect(search.find('new')).toMatchObject({ query: 'new', total: 0, canReplace: false, open: true });
    editSearch.getState.mockReturnValueOnce({ query: 'old', total: 9, activeIndex: 4 });
    expect(search.getSnapshot()).toMatchObject({ query: 'new', total: 0 });
    pending.resolve({ query: 'new', total: 1, activeIndex: 0 });
    await pending.promise;
    await Promise.resolve();
    expect(search.getSnapshot()).toMatchObject({ query: 'new', total: 1, canReplace: true });
  });

  it('drops a fallback result that lands after close', async () => {
    const { env, search, emitted } = setup();
    const pending = deferred<unknown>();
    const editSearch = { query: vi.fn((): unknown => pending.promise), getState: vi.fn(() => null) };
    env.editSearch = editSearch;
    search.find('a');
    search.close();
    expect(editSearch.query).toHaveBeenLastCalledWith({ query: '' });
    const count = emitted.length;
    pending.resolve({ query: 'a', total: 5 });
    await pending.promise;
    await Promise.resolve();
    expect(emitted).toHaveLength(count);
    expect(search.getSnapshot()).toMatchObject({ open: false, total: 0 });
  });

  it('resets state and releases the session on a document reset', () => {
    const { env, search, resetHooks } = setup();
    const host = hostSession();
    env.hostSearch = host;
    search.find('a');
    for (const hook of resetHooks) hook();
    expect(host.clear).toHaveBeenCalledOnce();
    expect(search.getSnapshot()).toMatchObject({ query: '', total: 0, open: false, available: true });
  });

  it('republishes when a mode change alters replace capability', () => {
    const { env, search, modeHooks, emitted } = setup();
    const state: Record<string, unknown> = { query: 'a', total: 1, canReplace: true };
    env.hostSearch = hostSession(state);
    search.find('a');
    const count = emitted.length;
    for (const hook of modeHooks) hook();
    expect(emitted).toHaveLength(count);
    state.canReplace = false;
    for (const hook of modeHooks) hook();
    expect(emitted).toHaveLength(count + 1);
    expect(emitted.at(-1)).toMatchObject({ canReplace: false });
  });

  it('keeps the settled outcome but suppresses publication when an observer closes mid-replace', async () => {
    const { env, search, emitted } = setup();
    const pending = deferred<unknown>();
    const editSearch = {
      query: vi.fn(() => ({ query: 'a', total: 1, activeIndex: 0 })),
      getState: vi.fn(() => ({ query: 'a', total: 1, activeIndex: 0 })),
      replace: vi.fn((): unknown => pending.promise),
    };
    env.editSearch = editSearch;
    env.commands['find.replace'] = { enabled: true };
    search.find('a');
    let closeOnNextEmit = true;
    search.observe(() => {
      if (!closeOnNextEmit) return;
      closeOnNextEmit = false;
      search.close();
    });
    const replaced = search.replace('b');
    const count = emitted.length;
    pending.resolve({ status: 'committed', total: 0 });
    expect(await replaced).toEqual({ ok: true });
    expect(emitted).toHaveLength(count);
    expect(editSearch.replace).toHaveBeenCalledWith({ replacement: 'b' });
  });

  it('refuses edit-command replace-all with the shell reason', () => {
    const { env, search } = setup();
    env.editSearch = { query: vi.fn(), getState: vi.fn(), replaceAll: vi.fn() };
    env.commands['find.replaceAll'] = { enabled: false, reason: 'search-truncated' };
    expect(search.replaceAll('b')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.searchTruncated });
    env.commands['find.replaceAll'] = { enabled: false };
    expect(search.replaceAll('b')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable });
  });

  it('ignores a late navigation result after in-flight requests are invalidated', async () => {
    const { env, search, controller, emitted } = setup();
    const pending = deferred<unknown>();
    env.editSearch = {
      query: vi.fn(() => ({ query: 'a', total: 2, activeIndex: 0 })),
      getState: vi.fn(() => ({ query: 'a', total: 2, activeIndex: 0 })),
      next: vi.fn((): unknown => pending.promise),
    };
    search.find('a');
    expect(search.next()).toEqual({ ok: true });
    controller.invalidateInFlightRequests();
    const count = emitted.length;
    pending.resolve({ query: 'a', total: 2, activeIndex: 1 });
    await pending.promise;
    await Promise.resolve();
    expect(emitted).toHaveLength(count);
  });

  it('refreshes an open session after the delay, and not after stop or disposal', () => {
    vi.useFakeTimers();
    const { env, search, controller } = setup();
    const host = hostSession();
    env.hostSearch = host;
    search.find('a');
    controller.scheduleRefresh();
    vi.advanceTimersByTime(SEARCH_REFRESH_DELAY_MS - 1);
    expect(host.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(host.refresh).toHaveBeenCalledOnce();

    controller.scheduleRefresh();
    controller.stopRefresh();
    vi.advanceTimersByTime(SEARCH_REFRESH_DELAY_MS);
    expect(host.refresh).toHaveBeenCalledOnce();

    controller.scheduleRefresh();
    env.disposed = true;
    vi.advanceTimersByTime(SEARCH_REFRESH_DELAY_MS);
    expect(host.refresh).toHaveBeenCalledOnce();
  });

  it('does not schedule a refresh while no query is open', () => {
    vi.useFakeTimers();
    const { env, controller } = setup();
    const host = hostSession();
    env.hostSearch = host;
    controller.scheduleRefresh();
    vi.advanceTimersByTime(SEARCH_REFRESH_DELAY_MS);
    expect(host.refresh).not.toHaveBeenCalled();
  });

  it('releases a pending shell refresh when refresh stops', () => {
    vi.useFakeTimers();
    const { env, search, controller } = setup();
    const editSearch = {
      query: vi.fn(() => ({ query: 'a', total: 1, activeIndex: 0 })),
      getState: vi.fn(() => ({ query: 'a', total: 1, activeIndex: 0 })),
      refresh: vi.fn(() => new Promise(() => {})),
    };
    env.editSearch = editSearch;
    search.find('a');
    controller.scheduleRefresh();
    vi.advanceTimersByTime(SEARCH_REFRESH_DELAY_MS);
    expect(editSearch.refresh).toHaveBeenCalledWith({
      query: 'a',
      caseSensitive: false,
      includeDeletedText: false,
      regex: false,
    });
    editSearch.query.mockClear();
    controller.stopRefresh();
    expect(editSearch.query).toHaveBeenCalledExactlyOnceWith({ query: '' });
  });

  it('stops emitting after listeners are cleared', () => {
    const { env, search, controller, emitted } = setup();
    env.hostSearch = hostSession();
    controller.clearListeners();
    const count = emitted.length;
    search.find('a');
    expect(emitted).toHaveLength(count);
  });
});
