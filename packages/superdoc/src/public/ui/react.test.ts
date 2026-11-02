import { describe, it, expect } from 'vite-plus/test';

import { toSliceSource, useSuperDocSlice } from './react.js';
import type { BorrowedSuperDocUI, Subscribable } from './types.js';

/**
 * A raw value substrate shaped like `ui.select(...)`: `get()` reads the current
 * value and `subscribe()` registers a change listener WITHOUT emitting on
 * attach (matching the controller's select() substrate). `set()` drives a
 * change so the adapter's change path can be exercised.
 */
function makeRawSubscribable<T>(initial: T): Subscribable<T> & { set(next: T): void } {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      value = next;
      for (const listener of [...listeners]) listener(value);
    },
  };
}

describe('superdoc/ui/react — useSuperDocSlice source normalization', () => {
  it('passes a snapshot source (getSnapshot + observe) through unchanged', () => {
    const handle = {
      getSnapshot: () => 'snap',
      observe: () => () => {},
    };
    expect(toSliceSource(handle)).toBe(handle);
  });

  it('adapts a raw Subscribable (get + subscribe) and updates on change', () => {
    const raw = makeRawSubscribable('a');
    const adapted = toSliceSource(raw);

    expect(adapted.getSnapshot()).toBe('a');

    const seen: string[] = [];
    const unsubscribe = adapted.observe((value) => seen.push(value));
    // observe() emits the current value immediately, then on each change.
    expect(seen).toEqual(['a']);

    raw.set('b');
    expect(seen).toEqual(['a', 'b']);

    unsubscribe();
    raw.set('c');
    expect(seen).toEqual(['a', 'b']);
  });

  it('subscribes before the immediate emit so a synchronous change is not missed', () => {
    const raw = makeRawSubscribable(0);
    const adapted = toSliceSource(raw);

    const seen: number[] = [];
    let triggered = false;
    adapted.observe((value) => {
      seen.push(value);
      if (!triggered) {
        triggered = true;
        // A synchronous recompute fired from the first (immediate) callback.
        raw.set(1);
      }
    });

    // The listener is already subscribed when raw.set(1) fires, so the change
    // is caught. An emit-first ordering would lose it.
    expect(seen).toEqual([0, 1]);
  });

  it('accepts a raw Subscribable pick as a SliceSource (type-level)', () => {
    // Compile-time contract for Fix B: `useSuperDocSlice`'s `pick` accepts a raw
    // `ui.select(...)` Subscribable (get/subscribe), not only snapshot handles.
    // Never invoked; the body exists only to be type-checked.
    const rawSubscribablePickIsAccepted = (): void => {
      useSuperDocSlice((ui: BorrowedSuperDocUI) => ui.select((s) => s.document.mode), null);
    };
    expect(typeof rawSubscribablePickIsAccepted).toBe('function');
  });
});
