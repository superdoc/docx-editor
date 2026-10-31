/**
 * The find/replace panel's settled-replace continuation.
 *
 * A worker-backed replace resolves asynchronously, and the session it belongs
 * to can be gone by then: the handle is reassigned when the active editor
 * changes and nulled on teardown. Publishing the resolved snapshot anyway would
 * repopulate the panel for a document the user is no longer looking at.
 *
 * This is the shell counterpart to the controller guards in
 * `search-stale-results.test.ts`. It exists because the guard previously lived
 * in two byte-identical inline closures that no reachable test could exercise,
 * and shipped with a comment saying so. Extracting the continuation to a named
 * function is what made the branch testable; these tests are the point of the
 * extraction, not a formality around it.
 */
import { describe, expect, it, vi } from 'vite-plus/test';

import { createReplaceContinuation } from './replace-continuation.js';

/** A session handle whose snapshot identifies which document it came from. */
function createSession(label) {
  return { label, getSnapshot: vi.fn(() => ({ from: label })) };
}

describe('createReplaceContinuation', () => {
  it('publishes the snapshot when the session is still the live one', () => {
    const session = createSession('first');
    const applySlice = vi.fn();
    const onSettled = vi.fn();

    createReplaceContinuation(session, {
      getCurrentSession: () => session,
      applySlice,
      onSettled,
    })();

    expect(applySlice).toHaveBeenCalledWith({ from: 'first' });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('skips the write when the active editor changed under it', () => {
    const issued = createSession('first');
    const live = createSession('second');
    const applySlice = vi.fn();
    const onSettled = vi.fn();

    createReplaceContinuation(issued, {
      getCurrentSession: () => live,
      applySlice,
      onSettled,
    })();

    // The resolved snapshot describes a document that is no longer open.
    expect(applySlice).not.toHaveBeenCalled();
    expect(issued.getSnapshot).not.toHaveBeenCalled();
    // Still settled, or the replace controls stay disabled forever.
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('skips the write after teardown nulled the session', () => {
    const issued = createSession('first');
    const applySlice = vi.fn();
    const onSettled = vi.fn();

    createReplaceContinuation(issued, {
      getCurrentSession: () => null,
      applySlice,
      onSettled,
    })();

    expect(applySlice).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('settles even when reading the snapshot throws', () => {
    const session = {
      label: 'first',
      getSnapshot: () => {
        throw new Error('host gone');
      },
    };
    const onSettled = vi.fn();

    const settle = createReplaceContinuation(session, {
      getCurrentSession: () => session,
      applySlice: vi.fn(),
      onSettled,
    });

    // A host torn down between resolution and read must not leave the panel
    // stuck pending.
    expect(() => settle()).not.toThrow();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('settles even when publishing the snapshot throws', () => {
    const session = createSession('first');
    const onSettled = vi.fn();

    const settle = createReplaceContinuation(session, {
      getCurrentSession: () => session,
      applySlice: () => {
        throw new Error('panel gone');
      },
      onSettled,
    });

    expect(() => settle()).not.toThrow();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
