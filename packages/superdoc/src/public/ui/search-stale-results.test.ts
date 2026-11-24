/**
 * Late async search results must not write into state that has moved on.
 *
 * `search()` captures `searchRequestGeneration` and re-checks it before
 * publishing. The other asynchronous entry points did not: `next()`,
 * `previous()`, `replace()` and `replaceAll()` all reach
 * `applyHostSearchResult` from a `.then(...)` with nothing compared. A
 * worker-backed call that settles after the session closed, after the active
 * editor changed, or after the controller was destroyed would republish the
 * previous document's match state over whatever replaced it.
 *
 * Each continuation is exercised separately against each of the four
 * boundaries, rather than one representative case, because they are four
 * independent code paths that happened to share a bug.
 *
 * `clear()` is a boundary in its own right, and it was missed on the first pass:
 * `close()` invalidated in-flight work while `clear()` did not, even though
 * `clear()` is documented as clearing the current query and matches.
 *
 * A harness note that matters more than it looks. `replace()` and `replaceAll()`
 * gate on the *edit-command snapshot* (`find.replace` / `find.replaceAll`
 * enabled), not on `search.getState().canReplace`. The first version of this file
 * supplied no such snapshot, so both methods returned `operation-unavailable`
 * synchronously and never built a promise at all — every replace case passed
 * without once reaching the asynchronous continuation it claimed to test. Adding
 * `editCommands.getSnapshot()` is what made them real, and with it all four
 * continuations genuinely depend on the guard at the close, clear, and
 * editor-change boundaries.
 *
 * Separately: staleness gates the *publication*, never the reported outcome. A
 * worker-backed replace that commits after its session ends still resolves with
 * the settled outcome, because that is what the method documents. An earlier
 * version returned `operation-unavailable` — the reason reserved for "no active
 * match" — telling a caller their edit had not happened when it had.
 *
 * These assert on what the controller *emits*, not on the state it happens to
 * settle at. A stale write is frequently masked: after `close()` a later
 * re-sync reads the now-empty backend and resets the slice, so the final total
 * looks correct even though the old document's matches were published to every
 * observer in between. Asserting the end state passes with the bug present,
 * which is how the first version of this file managed to prove nothing.
 */
import { describe, expect, it, vi } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';
import type { SuperDocUI } from './types.js';

/** A search facade whose async calls settle only when the test says so. */
function createDeferredSearchHost() {
  const pending: Array<(value: unknown) => void> = [];
  const defer = () =>
    new Promise((resolve) => {
      pending.push(resolve);
    });

  const MATCHES = { total: 3, activeMatchIndex: 0, matches: [{}, {}, {}], canReplace: true };
  const EMPTY = { total: 0, activeMatchIndex: -1, matches: [], canReplace: true };
  let state: Record<string, unknown> = MATCHES;
  const editSearch = {
    // A real fallback clears its session when queried with the empty string,
    // and reports empty from then on. A stub that keeps returning matches
    // forever makes `close()` look broken when it is not.
    query: vi.fn((input: { query?: string } | undefined) => {
      state = input?.query ? MATCHES : EMPTY;
      return state;
    }),
    getState: vi.fn(() => state),
    next: vi.fn(defer),
    previous: vi.fn(defer),
    replace: vi.fn(defer),
    replaceAll: vi.fn(defer),
  };

  const listeners = new Map<string, Set<() => void>>();
  // `replace`/`replaceAll` gate on the edit-command snapshot, not on
  // `search.getState().canReplace`. Without these entries the controller returns
  // `operation-unavailable` synchronously and never builds the promise, so the
  // async guard under test is never reached and the case passes vacuously. That
  // is exactly how the first version of this file "covered" both replace paths.
  const editCommands = {
    search: editSearch,
    getSnapshot: vi.fn(() => ({
      commands: {
        'find.replace': { enabled: true, supported: true },
        'find.replaceAll': { enabled: true, supported: true },
      },
    })),
  };
  const superdoc: Record<string, unknown> = {
    activeEditor: { id: 'first', editorVersion: 2, editCommands },
    on: (event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: () => void) => listeners.get(event)?.delete(handler),
  };

  return {
    superdoc,
    editSearch,
    editorReads: () => ({
      getState: editSearch.getState.mock.calls.length,
      query: editSearch.query.mock.calls.length,
      getSnapshot: editCommands.getSnapshot.mock.calls.length,
    }),
    emit: (event: string) => {
      for (const handler of [...(listeners.get(event) ?? [])]) handler();
    },
    /** Settle every outstanding call with a result from the OLD document. */
    settleAllWithStaleMatches: async () => {
      // `status: 'committed'` is what the controller's own result mapping
      // recognises as a landed mutation, so this models an edit that really
      // committed into a session that no longer exists. Anything else maps to
      // `operation-unavailable` and the outcome assertions would pass for the
      // wrong reason.
      const stale = {
        total: 99,
        activeMatchIndex: 7,
        matches: Array.from({ length: 99 }, () => ({})),
        status: 'committed',
      };
      for (const resolve of pending.splice(0)) resolve(stale);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

type Continuation = 'next' | 'previous' | 'replace' | 'replaceAll';
const CONTINUATIONS: Continuation[] = ['next', 'previous', 'replace', 'replaceAll'];

/** Open a session so `total` is non-zero, which `next`/`previous` require. */
function openSession(ui: SuperDocUI): void {
  ui.search.search('clause');
}

/** The match count only the previous document could produce. */
const STALE_TOTAL = 99;

/**
 * Record every total the controller publishes from now on. A late write is
 * often overwritten again moments later, so the emission is the evidence.
 */
function observeTotals(ui: SuperDocUI): () => number[] {
  const totals: number[] = [];
  ui.search.observe((slice) => totals.push(slice.total));
  totals.length = 0;
  return () => totals;
}

function invoke(ui: SuperDocUI, continuation: Continuation): void {
  if (continuation === 'next') void ui.search.next();
  else if (continuation === 'previous') void ui.search.previous();
  else if (continuation === 'replace') void ui.search.replace('x');
  else void ui.search.replaceAll('x');
}

/**
 * A committed mutation must be reported as committed even when its session is
 * gone.
 *
 * `replace()` and `replaceAll()` are documented to resolve with the settled
 * outcome once the mutation lands. The first version of the generation guard
 * returned `operation-unavailable` from a stale continuation, which is the reason
 * reserved for "no active match / replace cannot be applied" — so a caller whose
 * edit had committed was told it had not, inviting a duplicate replace or a
 * skipped save.
 *
 * The boundary belongs on the state publication, not on the return value. These
 * hold the promise, which the tests below deliberately do not.
 */
describe.each(['replace', 'replaceAll'] as const)('search.%s() outcome when it settles late', (continuation) => {
  const invalidate = {
    close: (ui: SuperDocUI) => ui.search.close(),
    clear: (ui: SuperDocUI) => ui.search.clear(),
    destroy: (ui: SuperDocUI) => ui.destroy(),
  };

  for (const [label, invalidateSession] of Object.entries(invalidate)) {
    it(`still reports the committed mutation after ${label}()`, async () => {
      const harness = createDeferredSearchHost();
      const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
      openSession(ui);

      const settled = continuation === 'replace' ? ui.search.replace('x') : ui.search.replaceAll('x');
      invalidateSession(ui);

      const emitted = observeTotals(ui);
      await harness.settleAllWithStaleMatches();
      const outcome = await settled;

      // The edit landed, so the caller must not be told it was unavailable.
      expect(outcome).not.toMatchObject({ reason: 'operation-unavailable' });
      expect(outcome.ok).toBe(true);
      // And the stale state still must not reach observers.
      expect(emitted()).not.toContain(STALE_TOTAL);
    });
  }
});

/**
 * An observer that ends the session during the pre-settlement emit.
 *
 * `replace()` and `replaceAll()` publish progress synchronously before awaiting,
 * and `emitSearch()` runs observer callbacks inline. An observer is free to close
 * or clear the session right there — a find panel dismissing itself when a
 * replace starts is enough. If the generation token is read after that emit it
 * picks up the value the boundary already advanced to, so the late result
 * compares equal, looks current, and republishes the old matches.
 *
 * Ordering, not logic: the guard was correct and simply read its token one line
 * too late.
 */
describe.each(['replace', 'replaceAll'] as const)('search.%s() with a re-entrant observer', (continuation) => {
  it('does not publish stale matches when an observer clears during the emit', async () => {
    const harness = createDeferredSearchHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    openSession(ui);

    // `observe()` invokes its listener once on registration, so the teardown has
    // to be armed afterwards. Without this the clear happens before `replace()`
    // is ever called, the token is already advanced when it is captured, and the
    // test passes or fails for reasons that have nothing to do with re-entrancy.
    let armed = false;
    let cleared = false;
    ui.search.observe(() => {
      if (!armed || cleared) return;
      cleared = true;
      ui.search.clear();
    });
    armed = true;

    const settled = continuation === 'replace' ? ui.search.replace('x') : ui.search.replaceAll('x');
    // The observer must have fired from inside the replace, or this proves nothing.
    expect(cleared).toBe(true);

    const emitted = observeTotals(ui);
    await harness.settleAllWithStaleMatches();
    await settled;

    expect(emitted()).not.toContain(STALE_TOTAL);
    ui.destroy();
  });
});

describe.each(CONTINUATIONS)('search.%s() settling late', (continuation) => {
  it('does not write into a closed session', async () => {
    const harness = createDeferredSearchHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    openSession(ui);
    invoke(ui, continuation);

    ui.search.close();
    expect(ui.search.getSnapshot().total).toBe(0);

    const emitted = observeTotals(ui);
    await harness.settleAllWithStaleMatches();

    // 99 is the old document's count. It must never be published.
    expect(emitted()).not.toContain(STALE_TOTAL);
    expect(ui.search.getSnapshot().open).toBe(false);
    ui.destroy();
  });

  it('does not write into a cleared session', async () => {
    const harness = createDeferredSearchHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    openSession(ui);
    invoke(ui, continuation);

    ui.search.clear();
    expect(ui.search.getSnapshot().total).toBe(0);

    const emitted = observeTotals(ui);
    await harness.settleAllWithStaleMatches();

    expect(emitted()).not.toContain(STALE_TOTAL);
    expect(ui.search.getSnapshot().query).toBe('');
    ui.destroy();
  });

  it('does not write into the replacement editor', async () => {
    const harness = createDeferredSearchHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    openSession(ui);
    invoke(ui, continuation);

    harness.superdoc.activeEditor = {
      id: 'second',
      editorVersion: 2,
      editCommands: { search: { query: () => null, getState: () => null } },
    };
    harness.emit('active-editor-change');
    expect(ui.search.getSnapshot().total).toBe(0);

    const emitted = observeTotals(ui);
    await harness.settleAllWithStaleMatches();

    expect(emitted()).not.toContain(STALE_TOTAL);
    ui.destroy();
  });

  it('does not read the old editor when it settles after the controller is destroyed', async () => {
    const harness = createDeferredSearchHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    openSession(ui);
    invoke(ui, continuation);

    ui.destroy();
    const readsAtDestroy = harness.editorReads();

    await harness.settleAllWithStaleMatches();

    expect(harness.editorReads()).toEqual(readsAtDestroy);
  });
});
