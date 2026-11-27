import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { isAllowed } from '../../core/collaboration/permissions.js';
import { SuperDoc } from '../../core/SuperDoc.js';
import type { CanPerformPermissionParams } from '../../core/types/index.js';
import { createPinia } from 'pinia';
import { useCommentsStore } from '../../stores/comments-store.js';
import { createSuperDocUI } from './create-super-doc-ui.js';

const change = { id: 'tc-1', type: 'insert', author: 'Alice' };
const mounted: ReturnType<typeof createSuperDocUI>[] = [];
afterEach(() => mounted.splice(0).forEach((ui) => ui.destroy()));

function mount(
  list: () => unknown,
  ids = ['tc-1'],
  windowItems?: unknown[],
  user: { name: string; email?: string } = { name: 'Alice' },
) {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  const hostListeners = new Set<(event: unknown) => void>();
  const decide = vi.fn(() => ({ success: true }));
  const canPerformPermission = vi.fn(({ permission }: { permission: string }) => !permission.endsWith('_OWN'));
  const editor = {
    editorVersion: 2,
    host: {
      events: {
        subscribe(listener: (event: unknown) => void) {
          hostListeners.add(listener);
          return () => hostListeners.delete(listener);
        },
      },
    },
    ...(windowItems
      ? {
          reviewWindow: { getSnapshot: () => ({ status: 'ready', trackedChangeItems: windowItems, commentItems: [] }) },
        }
      : {}),
    doc: {
      selection: { current: () => ({ empty: false, activeChangeIds: ids, activeCommentIds: [], activeMarks: [] }) },
      trackChanges: { list: vi.fn(list), decide },
    },
  };
  const superdoc = {
    activeEditor: editor,
    config: { documentMode: 'editing', user },
    canPerformPermission,
    on(event: string, listener: (payload?: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off(event: string, listener: (payload?: unknown) => void) {
      listeners.get(event)?.delete(listener);
    },
  };
  const ui = createSuperDocUI({ superdoc: superdoc as never });
  mounted.push(ui);
  const emit = (event: string, payload?: unknown) => listeners.get(event)?.forEach((listener) => listener(payload));
  return {
    ui,
    editor,
    superdoc,
    emit,
    setWindowItems: (items: unknown[]) => {
      windowItems = items;
    },
    emitMutation: () =>
      hostListeners.forEach((listener) => listener({ type: 'mutation:committed', origin: 'command' })),
    refresh: () => emit('document-mode-change'),
    list: editor.doc.trackChanges.list,
    decide,
    canPerformPermission,
  };
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function pending() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('tracked-change permission reads (SD-5019)', () => {
  it.each(['window', 'directory', 'legacy'] as const)(
    'defers tracked-change alias scans until focus is requested in the %s snapshot',
    async (surface) => {
      const readProvenance = vi.fn(() => '7');
      const row = {
        ...change,
        sourceIds: {
          get wordIdInsert() {
            return readProvenance();
          },
        },
      };
      const rows = [row];
      const h = mount(
        async () => ({ items: rows }),
        [],
        surface === 'window' ? rows : surface === 'directory' ? [] : undefined,
      );
      let snapshot = h.ui.trackChanges.getSnapshot();
      const stop =
        surface === 'directory'
          ? h.ui.trackChanges.observe((value) => {
              snapshot = value;
            })
          : () => {};
      await settle();
      h.refresh();
      if (surface !== 'directory') snapshot = h.ui.trackChanges.getSnapshot();
      expect(readProvenance).not.toHaveBeenCalled();
      expect(snapshot).toMatchObject({
        status: 'ready',
        listStatus: 'ready',
        total: 1,
        activeId: null,
        authors: ['Alice'],
      });
      expect(snapshot.items[0].change).toBe(row);
      expect(h.ui.trackChanges.setActive('imported:7')).toBe(true);
      expect(h.ui.trackChanges.getSnapshot().activeId).toBe('tc-1');
      expect(readProvenance).toHaveBeenCalled();
      stop();
    },
  );
  it('bounds pending catalog requests across selected IDs and repeated recomputes', () => {
    const read = pending();
    const h = mount(() => read.promise, ['tc-1', 'tc-2', 'tc-3']);
    for (let i = 0; i < 20; i++) h.refresh();
    // Current/all-story consumers may each request a catalog; permission
    // checks must not multiply those requests on the worker queue.
    expect(h.list.mock.calls.length).toBeGreaterThan(0);
    expect(h.list.mock.calls.length).toBeLessThanOrEqual(2);
    expect(h.decide).not.toHaveBeenCalled();
  });
  it('does not retry a settled catalog when a selected ID is absent', async () => {
    const h = mount(async () => ({ items: [] }));
    await settle();
    for (let i = 0; i < 20; i++) h.refresh();
    expect(h.list.mock.calls.length).toBeLessThanOrEqual(2);
    expect(h.decide).not.toHaveBeenCalled();
  });
  it.each([
    { label: 'visible', items: [change] },
    { label: 'missing', items: [] },
  ])('keeps $label page-window permission reads free of catalog requests', ({ items }) => {
    const h = mount(async () => ({ items: [change] }), ['tc-1'], items);
    for (let i = 0; i < 20; i++) h.refresh();
    expect(h.list).not.toHaveBeenCalled();
  });
  it('reads current window authorship on the first computation and after an update', () => {
    const items = [change];
    const h = mount(async () => ({ items: [] }), ['tc-1'], items);
    expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(false);
    h.setWindowItems([{ ...change, author: 'Bob' }]);
    h.refresh();
    expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(true);
    expect(h.list).not.toHaveBeenCalled();
  });
  it('uses an explicitly loaded off-window directory without repeated reads', async () => {
    const h = mount(async () => ({ items: [change] }), ['tc-1'], []);
    const unsubscribe = h.ui.trackChanges.observe(() => {});
    await settle();
    const callsAfterDirectoryLoad = h.list.mock.calls.length;
    expect(callsAfterDirectoryLoad).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) h.refresh();
    expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(false);
    expect(h.canPerformPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: 'RESOLVE_OWN',
        trackedChange: expect.objectContaining({ author: 'Alice' }),
      }),
    );
    expect(h.list).toHaveBeenCalledTimes(callsAfterDirectoryLoad);
    unsubscribe();
  });
  it('uses the new editor window immediately after switching editors', () => {
    const h = mount(async () => ({ items: [] }), ['tc-1'], [change]);
    expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(false);
    h.superdoc.activeEditor = {
      ...h.editor,
      reviewWindow: {
        getSnapshot: () => ({ status: 'ready', trackedChangeItems: [{ ...change, author: 'Bob' }], commentItems: [] }),
      },
    };
    h.emit('active-editor-change');
    expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(true);
    expect(h.list).not.toHaveBeenCalled();
  });
  it('handles a rejected catalog without launching a retry per permission check', async () => {
    const h = mount(() => Promise.reject(new Error('catalog unavailable')));
    await settle();
    for (let i = 0; i < 20; i++) h.refresh();
    expect(h.list.mock.calls.length).toBeLessThanOrEqual(2);
    expect(h.decide).not.toHaveBeenCalled();
  });
  it('uses settled asynchronous authorship to deny own-change decisions', async () => {
    const read = pending();
    const h = mount(() => read.promise);
    read.resolve({ items: [change] });
    await settle();
    h.refresh();
    expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(false);
    expect(h.canPerformPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: 'RESOLVE_OWN',
        trackedChange: expect.objectContaining({ author: 'Alice' }),
      }),
    );
    expect(await h.ui.toolbar.execute('track-changes-accept-selection')).toBe(false);
    expect(h.decide).not.toHaveBeenCalled();
  });
  it('retains synchronous own-change denial and other-change acceptance', async () => {
    const own = mount(() => ({ items: [change] }));
    expect(own.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(false);
    expect(await own.ui.toolbar.execute('track-changes-accept-selection')).toBe(false);
    expect(own.decide).not.toHaveBeenCalled();
    const other = mount(() => ({ items: [{ ...change, author: 'Bob' }] }));
    expect(other.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(true);
    expect(await other.ui.toolbar.execute('track-changes-accept-selection')).toEqual({ success: true });
    expect(other.decide).toHaveBeenCalledTimes(1);
  });
  it('reads authorship from the nested change of a tracked-change row', async () => {
    const own = mount(() => ({ items: [{ id: 'tc-1', change }] }));
    await settle();
    own.refresh();
    expect(own.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(false);
    expect(own.canPerformPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: 'RESOLVE_OWN',
        trackedChange: expect.objectContaining({ author: 'Alice' }),
      }),
    );
    const other = mount(() => ({ items: [{ id: 'tc-1', change: { ...change, author: 'Bob' } }] }));
    await settle();
    other.refresh();
    expect(other.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(true);
  });
  it.each([false, true])('retains known ownership during refresh (window directory: %s)', async (windowDirectory) => {
    const own = { ...change, authorEmail: 'alice@example.test' };
    const h = mount(async () => ({ items: [own] }), ['tc-1'], windowDirectory ? [] : undefined, {
      name: 'Alice',
      email: 'alice@example.test',
    });
    const unsubscribe = windowDirectory ? h.ui.trackChanges.observe(() => {}) : () => {};
    await settle();
    h.refresh();
    expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(false);
    const refreshing = pending();
    h.list.mockImplementation(() => refreshing.promise);
    h.emitMutation();
    expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(false);
    expect(h.ui.trackChanges.accept('tc-1')).toBe(false);
    expect(await h.ui.toolbar.execute('track-changes-accept-selection')).toBe(false);
    expect(h.decide).not.toHaveBeenCalled();
    refreshing.resolve({ items: [{ ...change, author: 'Bob', authorEmail: 'bob@example.test' }] });
    await settle();
    h.refresh();
    expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(true);
    unsubscribe();
  });
  it('ignores an old catalog settling after document replacement', async () => {
    const old = pending();
    const h = mount(() => old.promise);
    h.list.mockImplementation(async () => ({ items: [{ ...change, author: 'Bob' }] }));
    h.emit('document-replaced', { editor: h.editor });
    await settle();
    old.resolve({ items: [change] });
    await settle();
    h.refresh();
    expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(true);
  });
});

describe('SD-5713 unknown ownership', () => {
  it.each(['accept', 'reject'] as const)('allows %s when both ownership permissions allow', async (decision) => {
    const h = mount(async () => ({ items: [] }), ['tc-off-window'], []);
    h.canPerformPermission.mockImplementation(({ permission }) => isAllowed(permission, 'editor', false));
    h.refresh();
    expect(h.ui.commands.get(`track-changes-${decision}-selection`).getState().enabled).toBe(true);
    expect(await h.ui.toolbar.execute(`track-changes-${decision}-selection`)).toEqual({ success: true });
    expect(h.decide).toHaveBeenCalledTimes(1);
    const prefix = decision === 'accept' ? 'RESOLVE' : 'REJECT';
    expect(h.canPerformPermission).toHaveBeenCalledWith(expect.objectContaining({ permission: `${prefix}_OWN` }));
    expect(h.canPerformPermission).toHaveBeenCalledWith(expect.objectContaining({ permission: `${prefix}_OTHER` }));
    expect(h.list).not.toHaveBeenCalled();
  });
  it.each(['OWN', 'OTHER'])('keeps unknown ownership blocked when %s is denied', async (ownership) => {
    const h = mount(async () => ({ items: [] }), ['tc-off-window'], []);
    h.canPerformPermission.mockImplementation(({ permission }) => !permission.endsWith(`_${ownership}`));
    h.refresh();
    for (const decision of ['accept', 'reject']) {
      expect(h.ui.commands.get(`track-changes-${decision}-selection`).getState()).toMatchObject({
        enabled: false,
        reason: 'permission-denied',
      });
      expect(await h.ui.toolbar.execute(`track-changes-${decision}-selection`)).toBe(false);
    }
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.list).not.toHaveBeenCalled();
  });
});

describe('SD-5713 unsupported range commands', () => {
  it.each([1, 2])('disables both decisions for an unsplittable selection over %s changes', async (count) => {
    const ids = ['tc-1', 'tc-2'].slice(0, count);
    const rows = ids.map((id) => ({
      ...change,
      id,
      type: 'insertion',
      grouping: 'standalone',
      insertedText: 'alpha omega',
    }));
    const h = mount(() => ({ items: rows }), ids, rows);
    h.canPerformPermission.mockImplementation(() => true);
    h.editor.doc.selection.current = () => ({
      empty: false,
      activeChangeIds: ids,
      activeCommentIds: [],
      activeMarks: [],
      text: 'al',
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 0 },
        end: { kind: 'text', blockId: 'P1', offset: 2 },
      },
      trackedChangeRangeDecisionSupported: false,
    });
    h.emitMutation();
    h.refresh();
    for (const decision of ['accept', 'reject']) {
      expect(h.ui.commands.get(`track-changes-${decision}-selection`).getState()).toMatchObject({
        enabled: false,
        reason: 'operation-unavailable',
      });
    }
    expect(h.decide).not.toHaveBeenCalled();
  });
});

const builtInDecisionCases = ['editor', 'suggester', 'viewer'].flatMap((role) =>
  [false, true].flatMap((isInternal) =>
    ['own', 'other', 'unknown'].flatMap((ownership) =>
      ['accept', 'reject'].map((decision) => ({ role, isInternal, ownership, decision })),
    ),
  ),
);

it('SD-5951 decides built-in accept and reject by role, audience and ownership', async () => {
  const lines: string[] = [];
  for (const { role, isInternal, ownership, decision } of builtInDecisionCases) {
    const row = { ...change, author: ownership === 'other' ? 'Bob' : 'Alice' };
    const original = structuredClone(row);
    const h = mount(async () => ({ items: [] }), ['tc-1'], ownership === 'unknown' ? [] : [row]);
    const hydrations: string[] = [];
    Object.assign(h.superdoc.config, { role, isInternal });
    Object.assign(h.superdoc, {
      canPerformPermission: SuperDoc.prototype.canPerformPermission,
      commentsStore: {
        getComment: (id: string) => {
          hydrations.push(id);
          return { getValues: () => ({ commentId: 'context-row', author: 'Different stored author' }) };
        },
      },
    });
    h.refresh();
    const commandId = `track-changes-${decision}-selection`;
    const { enabled, reason } = h.ui.commands.get(commandId).getState();
    const result = await h.ui.toolbar.execute(commandId);
    expect(row).toEqual(original);
    lines.push(
      [
        `${role}, ${isInternal ? 'internal' : 'external'}, ${ownership} change, ${decision}:`,
        `  state: enabled=${enabled} reason=${reason ?? 'none'}`,
        `  execute: ${JSON.stringify(result)}`,
        `  decide calls: ${JSON.stringify(h.decide.mock.calls)}`,
        `  catalog reads: ${h.list.mock.calls.length}`,
        `  listed changes: ${JSON.stringify(h.ui.trackChanges.getSnapshot().items.map((item) => item.id))}`,
        `  comment hydrations: ${hydrations.length}`,
      ].join('\n'),
    );
  }
  await expect(`${lines.join('\n\n')}\n`).toMatchFileSnapshot(
    './__snapshots__/tracked-change-permission-reads/built-in-decisions.txt',
  );
});

function builtInHarness(rows: unknown[] = [{ ...change }], onHydrate: (id: string) => void = () => {}) {
  const h = mount(async () => ({ items: [] }), ['tc-1'], rows);
  const storedComment = { commentId: 'context-row', author: 'Stored author' };
  const getComment = (id: string) => {
    onHydrate(id);
    return id === 'tc-1' ? { getValues: () => storedComment } : undefined;
  };
  Object.assign(h.superdoc.config, { role: 'editor', isInternal: false });
  Object.assign(h.superdoc, {
    canPerformPermission: SuperDoc.prototype.canPerformPermission,
    commentsStore: { getComment },
  });
  return { ...h, storedComment };
}

it('SD-5951 re-evaluates ownership, user and policy on the same live instance', () => {
  const h = builtInHarness();
  const enabled = () => h.ui.commands.get('track-changes-reject-selection').getState().enabled;
  Object.assign(h.superdoc.config, { role: 'suggester' });
  h.refresh();
  expect(enabled()).toBe(true);
  h.setWindowItems([{ ...change, author: 'Bob' }]);
  h.refresh();
  expect(enabled()).toBe(false);
  h.superdoc.config.user = { name: 'Bob' };
  h.refresh();
  expect(enabled()).toBe(true);
  Object.assign(h.superdoc.config, { role: 'viewer', isInternal: true });
  h.refresh();
  expect(enabled()).toBe(false);
  Object.assign(h.superdoc.config, { role: 'editor', isInternal: false });
  h.refresh();
  expect(enabled()).toBe(true);
});

it.each(['top-level', 'deprecated'] as const)('SD-5951 retains live %s custom context and removal', (location) => {
  const row = { ...change };
  const h = builtInHarness([row]);
  const resolver = vi.fn(() => false);
  const comments = { permissionResolver: resolver as (() => false) | undefined };
  if (location === 'top-level') Object.assign(h.superdoc.config, { permissionResolver: resolver });
  else Object.assign(h.superdoc.config, { modules: { comments } });
  h.refresh();
  expect(h.ui.commands.get('track-changes-reject-selection').getState().enabled).toBe(false);
  expect(resolver).toHaveBeenCalled();
  for (const [payload] of resolver.mock.calls as unknown as [Record<string, unknown>][]) {
    expect(payload).toEqual({
      permission: payload.permission,
      role: 'editor',
      isInternal: false,
      defaultDecision: true,
      comment: h.storedComment,
      currentUser: h.superdoc.config.user,
      superdoc: h.superdoc,
      trackedChange: row,
    });
  }
  if (location === 'top-level') Object.assign(h.superdoc.config, { permissionResolver: undefined });
  else comments.permissionResolver = undefined;
  h.refresh();
  expect(h.ui.commands.get('track-changes-reject-selection').getState().enabled).toBe(true);
});

it('SD-5951 preserves the exact unbranded method payload and receiver after replacement', () => {
  const h = builtInHarness();
  h.refresh();
  const receivers: unknown[] = [];
  const method = vi.fn(function (this: unknown, _payload: Record<string, unknown>) {
    receivers.push(this);
    return false;
  });
  Object.assign(h.superdoc, { canPerformPermission: method });
  h.refresh();
  expect(h.ui.commands.get('track-changes-reject-selection').getState().enabled).toBe(false);
  expect(method).toHaveBeenCalled();
  for (const [payload] of method.mock.calls) {
    expect(payload).toEqual({ permission: payload.permission, trackedChange: change, comment: null });
  }
  expect(receivers.every((receiver) => receiver === h.superdoc)).toBe(true);
});

it.each(['known', 'unknown'] as const)('SD-5951 preserves %s custom throw and nonboolean semantics', (ownership) => {
  const h = builtInHarness(ownership === 'known' ? [{ ...change }] : []);
  Object.assign(h.superdoc.config, {
    permissionResolver: () => {
      throw new Error('policy failed');
    },
  });
  h.refresh();
  expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(ownership === 'known');
  Object.assign(h.superdoc.config, { permissionResolver: () => undefined });
  h.refresh();
  expect(h.ui.commands.get('track-changes-accept-selection').getState().enabled).toBe(true);
});

function groupCalls(calls: string[], startsGroup: (call: string) => boolean, endsGroup: (call: string) => boolean) {
  const groups = new Set<string>();
  let group: string[] = [];
  const close = () => {
    if (group.length) groups.add(group.join(' -> '));
    group = [];
  };
  for (const call of calls) {
    if (startsGroup(call)) close();
    group.push(call);
    if (endsGroup(call)) close();
  }
  close();
  return [...groups].sort().join('\n');
}

function integratorCallsPerDecision(calls: string[]): string {
  return groupCalls(
    calls,
    () => false,
    (call) => call.startsWith('permissionResolver('),
  );
}

type CanPerformPermission = (payload: CanPerformPermissionParams) => boolean;

function callsPerEvaluation(calls: string[]): string {
  return groupCalls(
    calls,
    (call) => call === 'read canPerformPermission',
    () => false,
  );
}

it.each(['own', 'inherited'] as const)(
  'SD-5951 decides with a live %s resolver accessor, read only for the decision',
  async (placement) => {
    const h = builtInHarness();
    const calls: string[] = [];
    let decision = false;
    const resolver = ({ permission, defaultDecision, comment }: Record<string, unknown>) => {
      calls.push(`permissionResolver(${JSON.stringify({ permission, defaultDecision, comment })}) = ${decision}`);
      return decision;
    };
    const owner = placement === 'own' ? h.superdoc.config : Object.create(Object.getPrototypeOf(h.superdoc.config));
    if (placement === 'inherited') Object.setPrototypeOf(h.superdoc.config, owner);
    Object.defineProperty(owner, 'permissionResolver', {
      configurable: true,
      get() {
        calls.push('read permissionResolver');
        return resolver;
      },
    });
    const accept = h.ui.commands.get('track-changes-accept-selection');
    h.refresh();
    const denied = accept.getState().enabled;
    const deniedCalls = integratorCallsPerDecision(calls.splice(0));
    decision = true;
    h.refresh();
    const allowed = accept.getState().enabled;
    const allowedCalls = integratorCallsPerDecision(calls.splice(0));
    await expect(
      `resolver denies:\n  accept enabled: ${denied}\n  integrator calls per decision:\n${deniedCalls}\n\nresolver allows:\n  accept enabled: ${allowed}\n  integrator calls per decision:\n${allowedCalls}\n`,
    ).toMatchFileSnapshot(`./__snapshots__/tracked-change-permission-reads/live-${placement}-resolver-accessor.txt`);
  },
);

it('SD-5951 follows a live permission-method getter, read once per evaluation', async () => {
  const calls: string[] = [];
  const h = builtInHarness(undefined, (id) => calls.push(`commentsStore.getComment(${JSON.stringify(id)})`));
  const builtIn = SuperDoc.prototype.canPerformPermission;
  const denying = (payload: CanPerformPermissionParams) => {
    calls.push(`canPerformPermission(${JSON.stringify({ permission: payload.permission })}) = false`);
    return false;
  };
  let method: CanPerformPermission = builtIn;
  Object.defineProperty(h.superdoc, 'canPerformPermission', {
    configurable: true,
    get() {
      calls.push('read canPerformPermission');
      return method;
    },
  });
  const phases: string[] = [];
  for (const [label, next] of [
    ['built-in method', builtIn],
    ['denying method', denying],
    ['built-in method again', builtIn],
  ] as const) {
    method = next;
    h.refresh();
    const enabled = h.ui.commands.get('track-changes-accept-selection').getState().enabled;
    phases.push(`${label}:\n  accept enabled: ${enabled}\n  calls:\n${callsPerEvaluation(calls.splice(0))}`);
  }
  await expect(`${phases.join('\n\n')}\n`).toMatchFileSnapshot(
    './__snapshots__/tracked-change-permission-reads/live-permission-method-getter.txt',
  );
});

it('SD-5951 reaches the built-in path with the real Pinia comments action', () => {
  const h = builtInHarness();
  Object.assign(h.superdoc, { commentsStore: useCommentsStore(createPinia()) });
  h.refresh();
  expect(h.ui.commands.get('track-changes-reject-selection').getState().enabled).toBe(true);
});
