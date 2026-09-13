import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createSuperDocUI, HEAVY_DOC_READ_POLICY, isHeavyDocReadKey } from './create-super-doc-ui.js';

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
  } = {},
): Harness {
  let stage: LoadStage = initialStage;
  let foreground = { active: 0, pending: 0 };
  let paragraphAlignment: 'left' | 'center' = 'left';
  let commentIds = options.initialCommentIds ?? ['c-1'];
  let commentAnchor = { offset: 0, anchoredText: 'hello' };
  const loadingListeners: Array<(snapshot: { sourceStage: LoadStage }) => void> = [];
  const eventListeners: Array<(event: Record<string, unknown>) => void> = [];

  const ccList = vi.fn(options.contentControlsList ?? (() => ({ items: [{ id: 'cc-1' }] })));
  const ccListInRange = vi.fn(() => ({ items: [{ id: 'cc-1' }] }));
  const hyperlinksList = vi.fn(() => ({ items: [] }));
  const stylesGetCatalog = vi.fn(() => ({
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
  const trackChangesFeedList = vi.fn(() => Promise.resolve({ items: [] }));

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
      current: () => ({
        empty: false,
        target: SELECTION_TARGET,
        selectionTarget: SELECTION_SELECTION_TARGET,
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
        text: 'hello',
      }),
    },
  };

  const host = {
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

    const requested = { view: 'inUse', types: ['paragraph'], includePreview: false } as const;
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

  it('selection reads stay live during source loading (caret correctness)', async () => {
    vi.useFakeTimers();
    const harness = makeHarness('source-loading');
    await settle();
    expect(isHeavyDocReadKey('selection')).toBe(false);
    expect(harness.ui.state.selection.status).toBe('ready');
    harness.ui.destroy();
  });
});
