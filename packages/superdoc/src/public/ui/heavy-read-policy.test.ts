import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { StylesGetCatalogInput } from '@superdoc/document-api';
import { createSuperDocUI } from './create-super-doc-ui.js';
import { HEAVY_DOC_READ_POLICY, isHeavyDocReadKey } from './heavy-read-policy.js';

/**
 * Table-driven heavy-read policy tests (during-load typing fix, W2).
 *
 * Every entry in `HEAVY_DOC_READ_POLICY` gets the same assertions, generated
 * from the SAME table the coordinator's gate consumes, so the deferred set
 * cannot silently drift from the tested set:
 *   1. the issuer really fires outside an observed load (vacuity guard),
 *   2. passive recompute defers the read while the source is loading,
 *   3. a settled value is stale-served (no cold refresh) while loading,
 *   4. the source-complete recompute issues the deferred read (idle-gated).
 * Keys with no issuer in this controller yet ("reserved") assert only the
 * matcher, and this test FAILS if a new policy entry has no issuer mapping —
 * growing the policy forces a conscious test decision.
 */

const SELECTION_TARGET = { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 5 } }] } as const;
const SELECTION_SELECTION_TARGET = {
  kind: 'selection',
  start: { kind: 'text', blockId: 'P1', offset: 0 },
  end: { kind: 'text', blockId: 'P3', offset: 5 },
} as const;

type LoadStage =
  | 'opening'
  | 'bootstrap-ready'
  | 'source-loading'
  | 'source-complete'
  | 'source-failed'
  | 'source-cancelled';

interface Harness {
  superdoc: Record<string, unknown>;
  ui: ReturnType<typeof createSuperDocUI>;
  /** Mutable load stage the host snapshot serves. */
  setStage: (stage: LoadStage) => void;
  /** Fire the captured subscribeDocumentLoading listeners with the current stage. */
  emitLoading: () => void;
  /** Fire a committed (non-text) mutation event through the host events seam. */
  emitMutation: () => void;
  /** Fire a committed TYPING-class mutation (carries `editableCommandKind`). */
  emitTypingMutation: () => void;
  /** Fire a remote collaboration apply with the production host payload. */
  emitRemoteMutation: (
    remoteGeneration: number,
    change?: { changedStoryIds?: string[]; changedPartUris?: string[] },
  ) => void;
  setComments: (ids: string[]) => void;
  setCommentAnchor: (offset: number, anchoredText: string) => void;
  setParagraphAlignment: (alignment: 'left' | 'center') => void;
  setForeground: (state: { active: number; pending: number }) => void;
  emitSelection: (snapshot: unknown) => void;
  setSelection: (selection: Record<string, unknown>) => void;
  hyperlinkInputs: () => unknown[];
  /** Per-policy-key issued-read counters. */
  countFor: (policyKey: string) => number;
  styleCatalogInputs: () => unknown[];
  /** Raw Document API fallback calls, which the shared v2 catalog must avoid. */
  countAllStoryFallback: () => number;
}

function makeHarness(
  initialStage: LoadStage,
  options: {
    transitionToCompleteDuringSubscribe?: boolean;
    contentControlsList?: () => unknown;
    commentsList?: () => unknown;
    initialCommentIds?: string[];
    selectionCurrent?: () => unknown;
    syncSelection?: () => unknown;
    reviewWindowItems?: () => Record<string, unknown>[];
    trackedChangesCatalog?: () => unknown;
  } = {},
): Harness {
  let stage: LoadStage = initialStage;
  let foreground = { active: 0, pending: 0 };
  let paragraphAlignment: 'left' | 'center' = 'left';
  let commentIds = options.initialCommentIds ?? ['c-1'];
  let commentAnchor = { offset: 0, anchoredText: 'hello' };
  const selectionListeners: Array<(snapshot: unknown) => void> = [];
  const loadingListeners: Array<(snapshot: { sourceStage: LoadStage }) => void> = [];
  const eventListeners: Array<(event: Record<string, unknown>) => void> = [];
  let currentSelection: Record<string, unknown> = {
    empty: false,
    target: SELECTION_TARGET,
    selectionTarget: SELECTION_SELECTION_TARGET,
    activeMarks: [],
    activeCommentIds: [],
    activeChangeIds: [],
    text: 'hello',
  };

  const ccList = vi.fn(options.contentControlsList ?? (() => ({ items: [{ id: 'cc-1' }] })));
  const ccListInRange = vi.fn(() => ({ items: [{ id: 'cc-1' }] }));
  const hyperlinksList = vi.fn((_input: unknown) => ({ items: [] }));
  const stylesGetCatalog = vi.fn((_input?: unknown) => ({
    styles: [],
    items: [],
    defaults: { paragraphStyleId: 'Normal' },
    diagnostics: [],
    revision: 'r1',
    sourceStatus: 'ready',
  }));
  const commentsList = vi.fn(
    options.commentsList ??
      (() => ({
        items: commentIds.map((id) => ({
          id,
          target: {
            kind: 'text',
            segments: [{ blockId: 'P1', range: { start: commentAnchor.offset, end: commentAnchor.offset + 5 } }],
          },
          anchoredText: commentAnchor.anchoredText,
        })),
      })),
  );
  const trackChangesList = vi.fn((input?: { in?: string }) => ({
    items: input?.in === 'all' ? [] : [],
  }));
  // Model the worker-backed bridge: both logical UI cache keys attach to one
  // shared asynchronous catalog transport.
  const trackChangesFeedList = vi.fn(
    options.trackedChangesCatalog ?? (() => Promise.resolve({ items: options.reviewWindowItems?.() ?? [] })),
  );

  const selectionCurrent = vi.fn(options.selectionCurrent ?? (() => currentSelection));
  const doc = {
    getNodeById: () => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment: paragraphAlignment } } },
    }),
    format: { paragraph: { setAlignment: vi.fn() } },
    comments: { list: commentsList },
    trackChanges: { list: trackChangesList },
    contentControls: { list: ccList, listInRange: ccListInRange },
    // `wrap` makes the routed `link` command resolvable so its active-state
    // read (`hyperlinks.list` within the selection blocks) actually issues.
    hyperlinks: { list: hyperlinksList, wrap: vi.fn() },
    styles: { getCatalog: stylesGetCatalog },
    selection: {
      current: selectionCurrent,
    },
  };

  const selectionSource = {
    subscribe: (listener: (snapshot: unknown) => void) => {
      selectionListeners.push(listener);
      return () => {
        const index = selectionListeners.indexOf(listener);
        if (index >= 0) selectionListeners.splice(index, 1);
      };
    },
  };
  const host = {
    getHandles: () => ({ editing: { selection: selectionSource } }),
    readLiveSelectionSyncSnapshot:
      options.syncSelection ??
      (() => ({
        empty: true,
        target: null,
        selectionTarget: null,
      })),
    getDocumentLoadingSnapshot: () => ({ sourceStage: stage }),
    subscribeDocumentLoading: (listener: (snapshot: { sourceStage: LoadStage }) => void) => {
      // Reproduce the non-replaying-subscription race: the host reaches its
      // terminal stage while the listener is being attached, but does not
      // replay that terminal snapshot to the new listener.
      if (options.transitionToCompleteDuringSubscribe) stage = 'source-complete';
      loadingListeners.push(listener);
      return () => {};
    },
    getForegroundMutationState: () => ({ ...foreground }),
    events: {
      subscribe: (listener: (event: Record<string, unknown>) => void) => {
        eventListeners.push(listener);
        return () => {};
      },
    },
  };

  const superdoc = {
    activeEditor: {
      ...(options.reviewWindowItems
        ? {
            editorVersion: 2,
            reviewWindow: {
              getSnapshot: () => ({
                status: 'ready',
                commentItems: [],
                trackedChangeItems: options.reviewWindowItems!(),
              }),
              subscribe: () => () => {},
            },
          }
        : {}),
      doc,
      host,
      v2TrackedChanges: { listTrackedChanges: trackChangesFeedList },
    },
    config: { documentMode: 'editing' },
    on: vi.fn(),
    off: vi.fn(),
  };
  const ui = createSuperDocUI({ superdoc: superdoc as never });

  const countFor = (policyKey: string): number => {
    switch (policyKey) {
      case 'selection':
        return selectionCurrent.mock.calls.length;
      case 'contentControls':
        return ccList.mock.calls.length;
      case 'contentControls:inRange:':
        return ccListInRange.mock.calls.length;
      case 'hyperlinks:':
        return hyperlinksList.mock.calls.length;
      case 'styles:catalog:':
        return stylesGetCatalog.mock.calls.length;
      case 'comments':
        return commentsList.mock.calls.length;
      case 'trackChanges':
      case 'trackChanges:all':
        return trackChangesFeedList.mock.calls.length;
      default:
        throw new Error(`no issuer counter mapped for policy key ${policyKey}`);
    }
  };

  return {
    superdoc,
    ui,
    setStage: (next) => {
      stage = next;
    },
    emitLoading: () => {
      for (const listener of loadingListeners) listener({ sourceStage: stage });
    },
    emitMutation: () => {
      for (const listener of eventListeners) listener({ type: 'mutation:committed', origin: 'command' });
    },
    emitTypingMutation: () => {
      for (const listener of eventListeners) {
        listener({ type: 'mutation:committed', origin: 'command', editableCommandKind: 'insert-text' });
      }
    },
    emitRemoteMutation: (
      remoteGeneration,
      change = {
        changedStoryIds: ['main:/word/document.xml'],
        changedPartUris: ['/word/document.xml'],
      },
    ) => {
      for (const listener of eventListeners) {
        listener({
          type: 'collaboration:remote-changed',
          remoteGeneration,
          changedStoryIds: change.changedStoryIds ?? [],
          changedPartUris: change.changedPartUris ?? [],
        });
      }
    },
    setComments: (ids) => {
      commentIds = ids;
    },
    setCommentAnchor: (offset, anchoredText) => {
      commentAnchor = { offset, anchoredText };
    },
    setParagraphAlignment: (alignment) => {
      paragraphAlignment = alignment;
    },
    setForeground: (state) => {
      foreground = state;
    },
    emitSelection: (snapshot) => {
      for (const listener of [...selectionListeners]) listener(snapshot);
    },
    setSelection: (selection) => {
      currentSelection = selection;
    },
    hyperlinkInputs: () => hyperlinksList.mock.calls.map(([input]) => input),
    countFor,
    styleCatalogInputs: () => stylesGetCatalog.mock.calls.map(([input]) => input),
    countAllStoryFallback: () =>
      trackChangesList.mock.calls.filter(([input]) => (input as { in?: string } | undefined)?.in === 'all').length,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Let coordinator reads settle under fake timers. The coordinator defers every
 * cold read by COLD_ASYNC_READ_START_DELAY_MS (180ms) whenever the host
 * exposes foreground-mutation state, so tests must advance past that window.
 */
async function settle(ms = 600): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flushMicrotasks();
}

/** Policy keys with no issuer in this controller yet (matcher-only coverage). */
const RESERVED_POLICY_KEYS = new Set(['tables', 'sections']);

afterEach(() => {
  vi.useRealTimers();
});

describe('public ui — document-wide selection work (SD-5650)', () => {
  const wideSelection = (count: number) => {
    const segments = Array.from({ length: count }, (_, i) => ({
      blockId: `work-paragraph-${i}`,
      range: { start: 0, end: 5 },
    }));
    return {
      empty: false,
      target: { kind: 'text', segments: [...segments, ...segments.slice(0, 3)] },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: segments[0].blockId, offset: 0 },
        end: { kind: 'text', blockId: segments.at(-1)!.blockId, offset: 5 },
      },
      activeMarks: [],
      activeCommentIds: [],
      activeChangeIds: [],
      text: 'hello',
    };
  };

  it('does not repeatedly scan the growing paragraph set during a wide command-state update', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete');
    await settle();
    let candidateReads = 0;
    const spies = (['includes', 'indexOf', 'lastIndexOf'] as const).map((method) => {
      const original = Array.prototype[method];
      return vi.spyOn(Array.prototype, method).mockImplementation(function (this: unknown[], ...args: unknown[]) {
        const query = args[0];
        if (
          typeof query !== 'string' ||
          !query.startsWith('work-paragraph-') ||
          typeof this[0] !== 'string' ||
          !this[0].startsWith('work-paragraph-')
        ) {
          return Reflect.apply(original, this, args);
        }
        const counted = new Proxy(this, {
          get(target, key, receiver) {
            if (typeof key === 'string' && /^\d+$/.test(key)) candidateReads++;
            return Reflect.get(target, key, receiver);
          },
        });
        return Reflect.apply(original, counted, args);
      });
    });
    try {
      // Calibrate the counter against the actual native membership operation.
      expect(['work-paragraph-0'].includes('work-paragraph-missing')).toBe(false);
      expect(candidateReads).toBe(1);
      candidateReads = 0;
      harness.setSelection(wideSelection(512));
      harness.emitSelection({
        anchor: { blockId: 'work-paragraph-0', blockOffset: 0 },
        focus: { blockId: 'work-paragraph-511', blockOffset: 5 },
      });
      await settle();
      expect(harness.ui.state.selection).toMatchObject({ status: 'ready', empty: false });
      expect(candidateReads).toBeLessThanOrEqual(512 * 128);
    } finally {
      for (const spy of spies) spy.mockRestore();
      harness.ui.destroy();
    }
  });

  it('keeps the first segment order, ignores invalid IDs and appends unseen endpoints', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    const selection = wideSelection(3);
    selection.target.segments = [
      { blockId: 'work-paragraph-1', range: { start: 0, end: 5 } },
      { blockId: 'work-paragraph-0', range: { start: 0, end: 5 } },
      { blockId: 'work-paragraph-1', range: { start: 0, end: 5 } },
      { blockId: '', range: { start: 0, end: 5 } },
      { blockId: 7 as never, range: { start: 0, end: 5 } },
    ];
    selection.selectionTarget.start.blockId = 'work-paragraph-2';
    selection.selectionTarget.end.blockId = 'work-paragraph-0';
    harness.setSelection(selection);
    harness.emitSelection({
      anchor: { blockId: 'work-paragraph-2', blockOffset: 0 },
      focus: { blockId: 'work-paragraph-0', blockOffset: 5 },
    });
    harness.setStage('source-complete');
    harness.emitLoading();
    await settle(7_000);
    const ids = harness.hyperlinkInputs().map((input) => (input as { within: { nodeId: string } }).within.nodeId);
    expect([...new Set(ids)]).toEqual(['work-paragraph-1', 'work-paragraph-0', 'work-paragraph-2']);
    harness.ui.destroy();
  });

  for (const count of [64, 65]) {
    it(`preserves the reactive metadata boundary for ${count} unique blocks`, async () => {
      vi.useFakeTimers();
      const harness = makeHarness('source-loading');
      harness.setSelection(wideSelection(count));
      harness.emitSelection({
        anchor: { blockId: 'work-paragraph-0', blockOffset: 0 },
        focus: { blockId: `work-paragraph-${count - 1}`, blockOffset: 5 },
      });
      harness.setStage('source-complete');
      harness.emitLoading();
      await settle(7_000);
      const ids = new Set(
        harness.hyperlinkInputs().map((input) => (input as { within: { nodeId: string } }).within.nodeId),
      );
      expect(ids.size).toBe(count === 64 ? 64 : 0);
      expect(harness.ui.state.selection).toMatchObject({ status: 'ready', empty: false });
      harness.ui.destroy();
    });
  }
});

describe('public ui — heavy-read policy during source loading (table-driven over HEAVY_DOC_READ_POLICY)', () => {
  it('every policy entry is either reserved or mapped to an issuer counter (fail closed on drift)', () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete');
    for (const entry of HEAVY_DOC_READ_POLICY) {
      if (RESERVED_POLICY_KEYS.has(entry.key)) continue;
      expect(() => harness.countFor(entry.key)).not.toThrow();
    }
    harness.ui.destroy();
  });

  for (const entry of HEAVY_DOC_READ_POLICY) {
    const sampleKey = entry.match === 'prefix' ? `${entry.key}anything` : entry.key;

    it(`matcher covers ${entry.key} (${entry.match})`, () => {
      expect(isHeavyDocReadKey(sampleKey)).toBe(true);
    });

    if (RESERVED_POLICY_KEYS.has(entry.key)) continue;

    it(`${entry.key}: issuer fires when no load is observed (vacuity guard)`, async () => {
      vi.useFakeTimers();
      const harness = makeHarness('source-complete');
      await settle();
      expect(harness.countFor(entry.key)).toBeGreaterThan(0);
      harness.ui.destroy();
    });

    it(`${entry.key}: passive recompute is deferred while the source is loading`, async () => {
      vi.useFakeTimers();
      const harness = makeHarness('source-loading');
      await settle();
      expect(harness.countFor(entry.key)).toBe(0);
      harness.ui.destroy();
    });

    it(`${entry.key}: settled value is stale-served (no cold refresh) while loading`, async () => {
      vi.useFakeTimers();
      const harness = makeHarness('source-complete');
      await settle();
      const settledCount = harness.countFor(entry.key);
      expect(settledCount).toBeGreaterThan(0);

      harness.setStage('source-loading');
      harness.emitMutation(); // bumps the content revision → recompute
      await settle(2_000);
      expect(harness.countFor(entry.key)).toBe(settledCount);
      harness.ui.destroy();
    });

    it(`${entry.key}: the source-complete recompute issues the deferred read`, async () => {
      vi.useFakeTimers();
      const harness = makeHarness('source-loading');
      await settle();
      expect(harness.countFor(entry.key)).toBe(0);

      harness.setStage('source-complete');
      harness.emitLoading();
      await settle(7_000);
      expect(harness.countFor(entry.key)).toBeGreaterThan(0);
      harness.ui.destroy();
    });
  }
});

describe('public ui — heavy-read policy behavior details', () => {
  it('confirms terminal loading state after attaching a non-replaying subscription', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading', {
      transitionToCompleteDuringSubscribe: true,
    });

    await settle(7_000);

    for (const entry of HEAVY_DOC_READ_POLICY) {
      if (RESERVED_POLICY_KEYS.has(entry.key)) continue;
      expect(harness.countFor(entry.key), entry.key).toBeGreaterThan(0);
    }
    harness.ui.destroy();
  });

  it('treats the interactive ready window as loading until source completion', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('bootstrap-ready');
    await settle(2_000);
    expect(harness.countFor('contentControls')).toBe(0);
    expect(harness.countFor('comments')).toBe(0);
    harness.ui.destroy();
  });

  it('backs off a rejected catalog read instead of retrying in a microtask loop', async () => {
    vi.useFakeTimers();
    const contentControlsList = vi.fn(() => Promise.reject(new Error('projection not ready')));
    const harness = makeHarness('source-complete', { contentControlsList });

    await settle(600);
    expect(contentControlsList).toHaveBeenCalledTimes(2);

    await settle(10_000);
    expect(contentControlsList.mock.calls.length).toBeGreaterThan(2);
    expect(contentControlsList.mock.calls.length).toBeLessThanOrEqual(8);
    harness.ui.destroy();
  });

  it.each(['sync', 'async', 'throw'])(
    'retries a %s failed tracked-change catalog without publishing an empty directory',
    async (transport) => {
      vi.useFakeTimers();
      const item = { id: 'restored-change', type: 'insert', insertedText: 'Restored after Undo' };
      let failNext = false;
      const catalog = vi.fn(() => {
        const failed = failNext;
        const result = failNext
          ? {
              ok: false,
              reason: 'track-changes-list-failed',
              detail: 'Tracked-change directory changed while it was being read.',
            }
          : { ok: true, items: [item] };
        failNext = false;
        if (transport === 'throw' && failed) throw new Error(result.detail);
        return transport === 'sync' ? result : Promise.resolve(result);
      });
      const harness = makeHarness('source-complete', { reviewWindowItems: () => [], trackedChangesCatalog: catalog });
      const snapshots: Array<{ status: string; total: number }> = [];
      const stop = harness.ui.trackChanges.observe((snapshot) =>
        snapshots.push({ status: snapshot.status, total: snapshot.total }),
      );
      try {
        await settle(1000);
        expect(harness.ui.trackChanges.setActive(item.id)).toBe(true);
        const before = catalog.mock.calls.length;
        snapshots.length = 0;
        failNext = true;
        harness.emitMutation();
        await settle(2000);
        expect(snapshots.filter((snapshot) => snapshot.status === 'ready' && snapshot.total === 0)).toEqual([]);
        expect(catalog.mock.calls.length).toBeGreaterThan(before + 1);
        expect(snapshots.at(-1)).toMatchObject({ status: 'ready', total: 1 });
        expect(harness.ui.trackChanges.setActive(item.id)).toBe(true);
      } finally {
        stop();
        harness.ui.destroy();
      }
    },
  );

  it('serves settled content-control items as stale (not blank) during loading', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete');
    await settle();
    expect(harness.ui.contentControls.getSnapshot().items).toHaveLength(1);

    harness.setStage('source-loading');
    harness.emitMutation();
    await settle(2_000);
    const snapshot = harness.ui.contentControls.getSnapshot();
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.status).not.toBe('ready');
    harness.ui.destroy();
  });

  it('explicit catalog demand (contentControls.list) issues the read during loading', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    await settle();
    expect(harness.countFor('contentControls')).toBe(0);

    harness.ui.contentControls.list();
    await settle();
    expect(harness.countFor('contentControls')).toBeGreaterThan(0);
    harness.ui.destroy();
  });

  it('observing content controls requests the catalog during loading', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    await settle();
    expect(harness.countFor('contentControls')).toBe(0);

    const stop = harness.ui.contentControls.observe(() => undefined);
    await settle();
    expect(harness.countFor('contentControls')).toBeGreaterThan(0);

    stop();
    harness.ui.destroy();
  });

  it('observeActivePath never requests the catalog, during loading or across mutations', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    await settle();
    expect(harness.countFor('contentControls')).toBe(0);

    const stop = harness.ui.contentControls.observeActivePath(() => undefined);
    await settle();
    expect(harness.countFor('contentControls')).toBe(0);

    harness.emitMutation();
    await settle();
    expect(harness.countFor('contentControls')).toBe(0);

    stop();
    harness.ui.destroy();
  });

  it('an attached content-control observer renews catalog demand across mutations', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    await settle();

    const stop = harness.ui.contentControls.observe(() => undefined);
    await settle();
    const attached = harness.countFor('contentControls');
    expect(attached).toBeGreaterThan(0);

    // A mutation advances the content revision. The still-mounted panel must
    // get the catalog for the new revision, not the one it attached at.
    harness.emitMutation();
    await settle();
    expect(harness.countFor('contentControls')).toBeGreaterThan(attached);

    stop();
    harness.ui.destroy();
  });

  it('explicit style-catalog demand issues only the requested read during loading', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    await settle();
    expect(harness.countFor('styles:catalog:')).toBe(0);

    const requested: StylesGetCatalogInput = { view: 'inUse', types: ['paragraph'], includePreview: false };
    harness.ui.styles.getCatalog(requested);
    await settle();
    harness.ui.styles.getCatalog(requested);
    await settle();
    expect(harness.countFor('styles:catalog:')).toBe(1);
    expect(harness.styleCatalogInputs()).toEqual([requested]);
    harness.ui.destroy();
  });

  it('tracked-change snapshot consumption stays passive during loading', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    await settle();
    expect(harness.countFor('trackChanges')).toBe(0);

    harness.ui.trackChanges.getSnapshot();
    await settle();
    expect(harness.countFor('trackChanges')).toBe(0);
    expect(harness.countFor('trackChanges:all')).toBe(0);
    expect(harness.countAllStoryFallback()).toBe(0);
    harness.ui.destroy();
  });

  it('explicit tracked-change list demand issues the shared feed read during loading', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    await settle();

    harness.ui.trackChanges.list();
    await settle();
    expect(harness.countFor('trackChanges')).toBeGreaterThan(0);
    expect(harness.countFor('trackChanges:all')).toBeGreaterThan(0);
    expect(harness.countAllStoryFallback()).toBe(0);
    harness.ui.destroy();
  });

  it('tracked-change snapshot reads do not bypass the typing hold after the catalog settles', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    harness.ui.trackChanges.list();
    await settle();
    const settledCount = harness.countFor('trackChanges');
    expect(settledCount).toBeGreaterThan(0);

    harness.emitTypingMutation();
    harness.ui.trackChanges.getSnapshot();
    await settle(2_000);
    expect(harness.countFor('trackChanges')).toBe(settledCount);
    harness.ui.destroy();
  });

  it('explicit catalog demand bypasses the post-complete idle hold', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    await settle();
    expect(harness.countFor('contentControls')).toBe(0);

    harness.emitMutation();
    harness.setStage('source-complete');
    harness.emitLoading();

    // Source completion alone remains idle-gated after the recent edit.
    await vi.advanceTimersByTimeAsync(500);
    expect(harness.countFor('contentControls')).toBe(0);

    // A consumer opening the panel explicitly demands the catalog and must not
    // wait for the 6.5s idle release.
    harness.ui.contentControls.list();
    await settle();
    expect(harness.countFor('contentControls')).toBeGreaterThan(0);
    harness.ui.destroy();
  });

  it('explicit catalog demand still defers while foreground mutation work is active', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    harness.setForeground({ active: 1, pending: 0 });

    harness.ui.contentControls.list();
    await settle();
    expect(harness.countFor('contentControls')).toBe(0);
    harness.ui.destroy();
  });

  it('the source-complete recompute is idle-gated while edits keep committing', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    expect(harness.countFor('contentControls')).toBe(0);

    // Simulate active typing: a committed mutation right before completion.
    harness.emitMutation();
    harness.setStage('source-complete');
    harness.emitLoading();

    // Within the sustained-typing idle window the recompute must keep waiting.
    await vi.advanceTimersByTimeAsync(500);
    expect(harness.countFor('contentControls')).toBe(0);

    // Once input has been idle for the sustained-typing window the deferred reads issue.
    await settle(7_000);
    expect(harness.countFor('contentControls')).toBeGreaterThan(0);
    harness.ui.destroy();
  });

  it('never releases a heavy read while continuous typing is active', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    harness.setStage('source-complete');
    harness.emitLoading();

    // Keep "typing": commit a mutation every 250ms so input never goes idle.
    for (let elapsed = 0; elapsed < 9_000; elapsed += 250) {
      harness.emitMutation();
      await vi.advanceTimersByTimeAsync(250);
    }
    await flushMicrotasks();
    expect(harness.countFor('contentControls')).toBe(0);

    await settle(7_000);
    expect(harness.countFor('contentControls')).toBeGreaterThan(0);
    harness.ui.destroy();
  });

  it('steady-phase typing holds heavy re-reads until input idle (no load in progress)', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete');
    await settle();
    const initial = harness.countFor('contentControls');
    expect(initial).toBeGreaterThan(0); // settled once in steady state

    // A typing burst: typing-class commits bump the content revision every
    // 250ms. The settled catalog must be stale-served, not re-fetched, while
    // keystrokes keep landing — catalog re-reads re-parse the full document
    // per revision and would otherwise convoy the worker mid-burst.
    for (let elapsed = 0; elapsed < 1_500; elapsed += 250) {
      harness.emitTypingMutation();
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(harness.countFor('contentControls')).toBe(initial);

    // Once typing has been idle for the sustained-typing window the deferred refresh issues.
    await settle(7_000);
    expect(harness.countFor('contentControls')).toBeGreaterThan(initial);
    harness.ui.destroy();
  });

  it('remote collaboration bursts refresh lightweight state but hold all heavy reads until idle', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete');
    await settle();
    const initialCounts = new Map(
      HEAVY_DOC_READ_POLICY.filter((entry) => !RESERVED_POLICY_KEYS.has(entry.key)).map((entry) => [
        entry.key,
        harness.countFor(entry.key),
      ]),
    );
    expect(harness.ui.commands.get('text-align').getState().value).toBe('left');

    for (let generation = 1; generation <= 6; generation += 1) {
      harness.setParagraphAlignment(generation % 2 === 0 ? 'left' : 'center');
      harness.emitRemoteMutation(generation);
      await vi.advanceTimersByTimeAsync(250);
      expect(harness.ui.commands.get('text-align').getState().value).toBe(generation % 2 === 0 ? 'left' : 'center');
      for (const [key, initialCount] of initialCounts) {
        expect(harness.countFor(key), key).toBe(initialCount);
      }
    }

    await settle(7_000);
    for (const [key, initialCount] of initialCounts) {
      expect(harness.countFor(key), key).toBeGreaterThan(initialCount);
    }
    harness.ui.destroy();
  });

  it('isolated remote comments-part changes refresh only comments promptly', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete');
    await settle();
    const initialCounts = new Map(
      HEAVY_DOC_READ_POLICY.filter((entry) => !RESERVED_POLICY_KEYS.has(entry.key)).map((entry) => [
        entry.key,
        harness.countFor(entry.key),
      ]),
    );

    harness.emitRemoteMutation(1, {
      changedStoryIds: [],
      changedPartUris: ['/word/comments.xml'],
    });
    await settle();

    expect(harness.countFor('comments')).toBeGreaterThan(initialCounts.get('comments')!);
    for (const [key, initialCount] of initialCounts) {
      if (key !== 'comments') expect(harness.countFor(key), key).toBe(initialCount);
    }

    await settle(7_000);
    for (const [key, initialCount] of initialCounts) {
      expect(harness.countFor(key), key).toBeGreaterThan(initialCount);
    }
    harness.ui.destroy();
  });

  it('comments-part changes bypass an existing remote typing hold only for comments', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete');
    await settle();
    const initialCounts = new Map(
      HEAVY_DOC_READ_POLICY.filter((entry) => !RESERVED_POLICY_KEYS.has(entry.key)).map((entry) => [
        entry.key,
        harness.countFor(entry.key),
      ]),
    );

    harness.emitRemoteMutation(1);
    await vi.advanceTimersByTimeAsync(250);
    harness.setComments(['c-1', 'c-2']);
    harness.emitRemoteMutation(2, {
      changedStoryIds: [],
      changedPartUris: ['/word/comments.xml'],
    });
    await settle();

    expect(harness.countFor('comments')).toBeGreaterThan(initialCounts.get('comments')!);
    expect(harness.ui.comments.getSnapshot().items.map((item) => item.id)).toEqual(['c-1', 'c-2']);
    for (const [key, initialCount] of initialCounts) {
      if (key !== 'comments') expect(harness.countFor(key), key).toBe(initialCount);
    }
    harness.ui.destroy();
  });

  it('document-only remote edits stale-serve loaded comment anchors until typing is idle', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete');
    await settle();
    const initialCounts = new Map(
      HEAVY_DOC_READ_POLICY.filter((entry) => !RESERVED_POLICY_KEYS.has(entry.key)).map((entry) => [
        entry.key,
        harness.countFor(entry.key),
      ]),
    );
    expect(harness.ui.comments.getSnapshot().items[0]).toMatchObject({
      anchoredText: 'hello',
      target: { segments: [{ range: { start: 0, end: 5 } }] },
    });

    harness.setCommentAnchor(7, 'world');
    harness.emitRemoteMutation(1, {
      changedStoryIds: ['main:/word/document.xml'],
      changedPartUris: ['/word/document.xml'],
    });
    await settle();

    expect(harness.countFor('comments')).toBe(initialCounts.get('comments')!);
    expect(harness.ui.comments.getSnapshot().items[0]).toMatchObject({
      anchoredText: 'hello',
      target: { segments: [{ range: { start: 0, end: 5 } }] },
    });

    await settle(7_000);
    expect(harness.countFor('comments')).toBeGreaterThan(initialCounts.get('comments')!);
    expect(harness.ui.comments.getSnapshot().items[0]).toMatchObject({
      anchoredText: 'world',
      target: { segments: [{ range: { start: 7, end: 12 } }] },
    });
    for (const [key, initialCount] of initialCounts) {
      expect(harness.countFor(key), key).toBeGreaterThan(initialCount);
    }
    harness.ui.destroy();
  });

  it('document-only remote edits supersede an unresolved comments read after typing is idle', async () => {
    vi.useFakeTimers();
    let resolveInitialComments!: (value: unknown) => void;
    const initialComments = new Promise((resolve) => {
      resolveInitialComments = resolve;
    });
    let commentsReadCount = 0;
    const harness = makeHarness('source-complete', {
      commentsList: () => {
        commentsReadCount += 1;
        if (commentsReadCount === 1) return initialComments;
        return {
          items: [
            {
              id: 'c-1',
              anchoredText: 'world',
              target: {
                kind: 'text',
                segments: [{ blockId: 'P1', range: { start: 7, end: 12 } }],
              },
            },
          ],
        };
      },
    });
    await settle(200);
    expect(harness.countFor('comments')).toBe(1);

    harness.emitRemoteMutation(1);
    await settle();
    expect(harness.countFor('comments')).toBe(1);

    await settle(7_000);
    expect(harness.countFor('comments')).toBe(2);
    expect(harness.ui.comments.getSnapshot().items[0]).toMatchObject({
      anchoredText: 'world',
      target: { segments: [{ range: { start: 7, end: 12 } }] },
    });

    resolveInitialComments({ items: [] });
    await flushMicrotasks();
    expect(harness.ui.comments.getSnapshot().items[0]).toMatchObject({
      anchoredText: 'world',
      target: { segments: [{ range: { start: 7, end: 12 } }] },
    });
    harness.ui.destroy();
  });

  it('document-only remote edits do not cold-start an empty comments catalog during the typing hold', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete', { initialCommentIds: [] });
    await settle();
    const initial = harness.countFor('comments');

    harness.emitRemoteMutation(1);
    await settle();

    expect(harness.countFor('comments')).toBe(initial);
    harness.ui.destroy();
  });

  it('remote collaboration bursts keep heavy re-reads deferred until real idle', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete');
    await settle();
    const initial = harness.countFor('contentControls');

    for (let elapsed = 0; elapsed < 9_000; elapsed += 250) {
      harness.emitRemoteMutation(elapsed / 250 + 1);
      await vi.advanceTimersByTimeAsync(250);
      expect(harness.countFor('contentControls')).toBe(initial);
    }

    await flushMicrotasks();
    expect(harness.countFor('contentControls')).toBe(initial);

    await settle(7_000);
    expect(harness.countFor('contentControls')).toBeGreaterThan(initial);
    harness.ui.destroy();
  });

  it('SD-5646 holds deferred typed-caret validation through inter-key gaps without blocking fresh ranges', async () => {
    vi.useFakeTimers();
    let offset = 0;
    const caret = () => ({
      empty: true,
      target: null,
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset },
        end: { kind: 'text', blockId: 'P1', offset },
      },
      activeMarks: [],
      activeCommentIds: [],
      activeChangeIds: [],
    });
    const harness = makeHarness('source-complete', { selectionCurrent: caret, syncSelection: caret });
    await settle();
    const before = harness.countFor('selection');
    harness.setForeground({ active: 1, pending: 0 });
    offset = 1;
    harness.emitTypingMutation();
    harness.emitSelection({ anchor: { blockId: 'P1', blockOffset: 1 }, focus: { blockId: 'P1', blockOffset: 1 } });
    harness.setForeground({ active: 0, pending: 1 });
    harness.emitSelection({ anchor: { blockId: 'P1', blockOffset: 1 }, focus: { blockId: 'P1', blockOffset: 1 } });
    harness.setForeground({ active: 0, pending: 0 });
    await settle(1000);
    expect(
      harness.countFor('selection'),
      'deferred authoritative validation cannot occupy the worker between keys',
    ).toBe(before);
    expect(harness.ui.state.selection.selectionTarget).toMatchObject({ start: { offset: 1 }, end: { offset: 1 } });
    harness.emitSelection({ anchor: { blockId: 'P1', blockOffset: 0 }, focus: { blockId: 'P1', blockOffset: 5 } });
    expect(harness.countFor('selection'), 'explicit range selection still reads immediately').toBeGreaterThan(before);
    harness.ui.destroy();
  });

  it('keeps tracked-change list readiness independent of a pending selection read', async () => {
    vi.useFakeTimers();
    let holdSelection = false;
    const harness = makeHarness('source-complete', {
      selectionCurrent: () =>
        holdSelection ? new Promise(() => {}) : { empty: true, activeChangeIds: [], activeCommentIds: [] },
      reviewWindowItems: () => [{ id: 'existing', type: 'insert', insertedText: 'retained' }],
    });
    const snapshots: unknown[] = [];
    const stop = harness.ui.trackChanges.observe((snapshot) => snapshots.push(snapshot));
    await settle();
    holdSelection = true;
    harness.emitSelection({ anchor: { blockId: 'P1', blockOffset: 0 }, focus: { blockId: 'P1', blockOffset: 5 } });
    await settle();
    expect(harness.ui.selection.getSnapshot().status).not.toBe('ready');
    expect(harness.ui.trackChanges.getSnapshot()).toMatchObject({
      listStatus: 'ready',
      total: 1,
      items: [{ id: 'existing' }],
    });
    expect(snapshots.at(-1)).toMatchObject({ listStatus: 'ready', total: 1 });
    stop();
    harness.ui.destroy();
  });

  it('withholds retained selection rectangles while a different selection read is pending', async () => {
    vi.useFakeTimers();
    const target = (start: number, end: number) => ({
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'P1', offset: start },
      end: { kind: 'text' as const, blockId: 'P1', offset: end },
    });
    const oldTarget = target(0, 5),
      nextTarget = target(8, 12);
    const selectionValue = (selectionTarget: ReturnType<typeof target>) => ({
      empty: false,
      selectionTarget,
      activeChangeIds: [],
      activeCommentIds: [],
    });
    let pending = false;
    let complete!: (value: unknown) => void;
    const harness = makeHarness('source-complete', {
      selectionCurrent: () =>
        pending
          ? new Promise((resolve) => {
              complete = resolve;
            })
          : selectionValue(oldTarget),
    });
    const rect = (left: number) => ({
      left,
      right: left + 50,
      top: 10,
      bottom: 20,
      width: 50,
      height: 10,
      pageIndex: 0,
    });
    const host = (harness.superdoc.activeEditor as { host: Record<string, unknown> }).host;
    host.getTargetRects = vi.fn(({ target: value }: { target: { start: { offset: number } } }) => ({
      success: true,
      rects: [rect(value.start.offset === 0 ? 10 : 90)],
    }));
    try {
      await settle();
      expect(harness.ui.selection.getSnapshot().status).toBe('ready');
      expect(harness.ui.selection.getRects()).toEqual([rect(10)]);
      pending = true;
      harness.emitSelection({ anchor: { blockId: 'P1', blockOffset: 8 }, focus: { blockId: 'P1', blockOffset: 12 } });
      await settle();
      expect(harness.ui.selection.getSnapshot()).toMatchObject({ status: 'stale', selectionTarget: oldTarget });
      expect(harness.ui.selection.getRects()).toEqual([]);
      expect(harness.ui.viewport.getRect({ target: oldTarget })).toMatchObject({ found: true, rects: [rect(10)] });
      complete(selectionValue(nextTarget));
      await settle();
      expect(harness.ui.selection.getSnapshot()).toMatchObject({ status: 'ready', selectionTarget: nextTarget });
      expect(harness.ui.selection.getRects()).toEqual([rect(90)]);
    } finally {
      harness.ui.destroy();
    }
  });

  it.each([0, 900])('SD-5646 keeps an observed review directory ready after a %ims foreground tail', async (tailMs) => {
    vi.useFakeTimers();
    let offset = 0;
    const caret = () => ({
      empty: true,
      target: null,
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset },
        end: { kind: 'text', blockId: 'P1', offset },
      },
      activeMarks: [],
      activeCommentIds: [],
      activeChangeIds: [],
    });
    let changes: Record<string, unknown>[] = [];
    const harness = makeHarness('source-complete', {
      selectionCurrent: caret,
      syncSelection: caret,
      reviewWindowItems: () => changes,
    });
    let directory = harness.ui.trackChanges.getSnapshot();
    const stop = harness.ui.trackChanges.observe((snapshot) => {
      directory = snapshot;
    });
    await settle();
    expect(harness.ui.trackChanges.getSnapshot().status).toBe('ready');
    const initialSelectionReads = harness.countFor('selection');
    const initialDirectoryReads = harness.countFor('trackChanges');

    harness.setForeground({ active: 1, pending: 0 });
    offset = 2;
    changes = [{ id: 'ime-1', type: 'insert', insertedText: '甲乙' }];
    harness.emitTypingMutation();
    harness.emitSelection({ anchor: { blockId: 'P1', blockOffset: 2 }, focus: { blockId: 'P1', blockOffset: 2 } });
    harness.setForeground({ active: 0, pending: tailMs > 0 ? 1 : 0 });
    await settle(tailMs);
    harness.setForeground({ active: 0, pending: 0 });
    await settle(1000);

    expect(harness.countFor('trackChanges')).toBeGreaterThan(initialDirectoryReads);
    expect(directory).toMatchObject({
      status: 'ready',
      total: 1,
      items: [{ id: 'ime-1', type: 'insert', insertedText: '甲乙' }],
    });
    expect(harness.ui.selection.getSnapshot()).toMatchObject({
      status: 'ready',
      selectionTarget: { start: { offset: 2 }, end: { offset: 2 } },
    });
    expect(harness.countFor('selection'), 'the worker caret validation must remain deferred').toBe(
      initialSelectionReads,
    );
    stop();
    harness.ui.destroy();
  });

  it('selection reads stay live during source loading (caret correctness)', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    await settle();
    expect(isHeavyDocReadKey('selection')).toBe(false);
    expect(harness.ui.state.selection.status).toBe('ready');
    harness.ui.destroy();
  });

  it('reads a fresh selection immediately while the host holds background reads for input idle (SD-5394)', () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-complete');
    harness.setForeground({ active: 0, pending: 1 });
    harness.emitSelection({
      anchor: { blockId: 'P1', blockOffset: 0 },
      focus: { blockId: 'P1', blockOffset: 5 },
    });
    expect(harness.ui.state.selection).toMatchObject({ status: 'ready', empty: false, quotedText: 'hello' });
    expect(harness.countFor('comments')).toBe(0);
    expect(harness.countFor('contentControls')).toBe(0);
    expect(harness.countFor('styles:catalog:')).toBe(0);
    harness.ui.destroy();
  });
});
