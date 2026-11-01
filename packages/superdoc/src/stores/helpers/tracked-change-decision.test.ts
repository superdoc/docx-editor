import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  clearV2ActiveTrackedChangeTarget,
  collectReliableDecidedTrackedChangeIds,
  collectTrackedChangeDecisionIdsWithAliases,
  collectTrackedChangeEntityIdsFromReceipt,
  normalizeTrackedChangeDecisionType,
  trackedChangeDecisionKeepsCommentAnchor,
  waitForTrackedDecisionCanonicalPaint,
} from './tracked-change-decision.js';

const trackedChangeRef = (entityId: unknown) => ({ kind: 'entity', entityType: 'trackedChange', entityId });

describe('normalizeTrackedChangeDecisionType', () => {
  it('maps insertion and deletion aliases case-insensitively', () => {
    for (const alias of ['insert', 'Insertion', 'trackInsert', 'tableInsert', 'paragraphSplit']) {
      expect(normalizeTrackedChangeDecisionType(alias)).toBe('insertion');
    }
    for (const alias of ['delete', 'DELETION', 'trackDelete', 'tableDelete']) {
      expect(normalizeTrackedChangeDecisionType(alias)).toBe('deletion');
    }
  });

  it('lowercases other types and returns null for empty or non-string values', () => {
    expect(normalizeTrackedChangeDecisionType('Format')).toBe('format');
    expect(normalizeTrackedChangeDecisionType('')).toBeNull();
    expect(normalizeTrackedChangeDecisionType(null)).toBeNull();
    expect(normalizeTrackedChangeDecisionType(7)).toBeNull();
  });
});

describe('trackedChangeDecisionKeepsCommentAnchor', () => {
  it('keeps the anchor when accepting an insertion or rejecting a deletion', () => {
    expect(
      trackedChangeDecisionKeepsCommentAnchor({ comment: { trackedChangeType: 'trackInsert' }, decision: 'accept' }),
    ).toBe(true);
    expect(
      trackedChangeDecisionKeepsCommentAnchor({ comment: { trackedChangeType: 'trackDelete' }, decision: 'reject' }),
    ).toBe(true);
  });

  it('drops the anchor when rejecting an insertion, accepting a deletion, or deciding nothing', () => {
    expect(
      trackedChangeDecisionKeepsCommentAnchor({ comment: { trackedChangeType: 'insert' }, decision: 'reject' }),
    ).toBe(false);
    expect(
      trackedChangeDecisionKeepsCommentAnchor({ comment: { trackedChangeType: 'delete' }, decision: 'accept' }),
    ).toBe(false);
    expect(trackedChangeDecisionKeepsCommentAnchor({ comment: { trackedChangeType: 'insert' }, decision: 'x' })).toBe(
      false,
    );
    expect(trackedChangeDecisionKeepsCommentAnchor()).toBe(false);
  });

  it('prefers the display type over the stored type', () => {
    expect(
      trackedChangeDecisionKeepsCommentAnchor({
        comment: { trackedChangeDisplayType: 'deletion', trackedChangeType: 'insertion' },
        decision: 'reject',
      }),
    ).toBe(true);
  });
});

describe('collectTrackedChangeDecisionIdsWithAliases', () => {
  it('collects aliases, the canonical id, the anchor key, and the raw id of a tc:: anchor key', () => {
    const ids = collectTrackedChangeDecisionIdsWithAliases(
      { trackedChangeCanonicalId: 42, trackedChangeAnchorKey: 'tc::body::raw-1' },
      ['alias-1', 'alias-2'],
    );
    expect([...ids]).toEqual(['alias-1', 'alias-2', '42', 'tc::body::raw-1', 'raw-1']);
  });

  it('adds no raw id for other anchor keys or an empty tc:: suffix', () => {
    expect([...collectTrackedChangeDecisionIdsWithAliases({ trackedChangeAnchorKey: 'plain-key' }, [])]).toEqual([
      'plain-key',
    ]);
    expect([...collectTrackedChangeDecisionIdsWithAliases({ trackedChangeAnchorKey: 'tc::body::' }, [])]).toEqual([
      'tc::body::',
    ]);
  });

  it('returns only the aliases for a missing row', () => {
    expect([...collectTrackedChangeDecisionIdsWithAliases(null, ['a'])]).toEqual(['a']);
  });
});

describe('collectTrackedChangeEntityIdsFromReceipt', () => {
  it('collects tracked-change entity ids from removed and invalidatedRefs', () => {
    const ids = collectTrackedChangeEntityIdsFromReceipt({
      success: true,
      removed: [
        trackedChangeRef('tc-1'),
        trackedChangeRef(''),
        { kind: 'entity', entityType: 'comment', entityId: 'c' },
      ],
      invalidatedRefs: [trackedChangeRef(5), null, { kind: 'text', entityType: 'trackedChange', entityId: 'x' }],
    });
    expect([...ids]).toEqual(['tc-1', '5']);
  });

  it('returns nothing for a failed or missing receipt', () => {
    expect(collectTrackedChangeEntityIdsFromReceipt({ success: false, removed: [trackedChangeRef('tc-1')] }).size).toBe(
      0,
    );
    expect(collectTrackedChangeEntityIdsFromReceipt(null).size).toBe(0);
  });
});

describe('collectReliableDecidedTrackedChangeIds', () => {
  it('joins the decided id, decided ids, and receipt ids, skipping empty values', () => {
    const ids = collectReliableDecidedTrackedChangeIds({
      decidedId: 'a',
      decidedIds: ['b', '', null, 3],
      receipt: { success: true, removed: [trackedChangeRef('c')] },
    });
    expect([...ids]).toEqual(['a', 'b', '3', 'c']);
    expect(collectReliableDecidedTrackedChangeIds(null).size).toBe(0);
  });
});

describe('clearV2ActiveTrackedChangeTarget', () => {
  it('asks the adapter to clear a matching target and swallows its failure', () => {
    const clear = vi.fn(() => {
      throw new Error('host gone');
    });
    expect(() =>
      clearV2ActiveTrackedChangeTarget({ clearActiveTrackedChangeTargetIfMatches: clear }, 'tc-1'),
    ).not.toThrow();
    expect(clear).toHaveBeenCalledWith('tc-1');
  });

  it('does nothing without an id or a clear method', () => {
    const clear = vi.fn();
    clearV2ActiveTrackedChangeTarget({ clearActiveTrackedChangeTargetIfMatches: clear }, '');
    clearV2ActiveTrackedChangeTarget({}, 'tc-1');
    clearV2ActiveTrackedChangeTarget(null, 'tc-1');
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('waitForTrackedDecisionCanonicalPaint', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const hostWith = (whenPainted: () => unknown) => ({
    activeEditor: { documentMutationReadiness: { whenPainted } },
  });

  it('returns without waiting when the receipt is not a successful transaction', async () => {
    const whenPainted = vi.fn();
    const superdoc = hostWith(whenPainted);
    await waitForTrackedDecisionCanonicalPaint({ superdoc, receipt: { success: false, txId: 'tx-1' } });
    await waitForTrackedDecisionCanonicalPaint({ superdoc, receipt: { success: true, txId: '' } });
    await waitForTrackedDecisionCanonicalPaint({ superdoc, receipt: { success: true } });
    await waitForTrackedDecisionCanonicalPaint({ superdoc: {}, receipt: { success: true, txId: 'tx-1' } });
    await waitForTrackedDecisionCanonicalPaint();
    expect(whenPainted).not.toHaveBeenCalled();
  });

  it('waits for the paint, then falls back to a 250 ms timer when frames never arrive', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    const receipt = { success: true, txId: 'tx-1' };
    const whenPainted = vi.fn(() => Promise.resolve());
    let done = false;
    const wait = waitForTrackedDecisionCanonicalPaint({ superdoc: hostWith(whenPainted), receipt }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(whenPainted).toHaveBeenCalledWith(receipt);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(done).toBe(true);
  });

  it('settles after two frames without waiting for the fallback', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
    let done = false;
    const wait = waitForTrackedDecisionCanonicalPaint({
      superdoc: hostWith(() => Promise.resolve()),
      receipt: { success: true, txId: 'tx-1' },
    }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    await wait;
    expect(done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves when the paint waiter rejects', async () => {
    await expect(
      waitForTrackedDecisionCanonicalPaint({
        superdoc: hostWith(() => Promise.reject(new Error('torn down'))),
        receipt: { success: true, txId: 'tx-1' },
      }),
    ).resolves.toBeUndefined();
  });
});
