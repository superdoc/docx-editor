import { describe, expect, it, vi } from 'vite-plus/test';
import { getPendingSelectionSnapshot } from './pending-selection-snapshot.js';
import type { PendingSelectionHost } from './pending-selection-snapshot.js';

const snapshot = { target: { kind: 'text' }, empty: false };
const editorSelection = { source: 'document-editor', documentId: 'doc-1' };

const hostWith = (current: (() => unknown) | undefined, documentId: unknown = 'doc-1'): PendingSelectionHost => ({
  activeEditor: { options: { documentId }, doc: { selection: { current } } },
});

describe('getPendingSelectionSnapshot', () => {
  it('returns a synchronous snapshot as is', () => {
    const current = vi.fn(() => snapshot);
    expect(getPendingSelectionSnapshot(hostWith(current), editorSelection)).toBe(snapshot);
    expect(current).toHaveBeenCalledTimes(1);
  });

  it('returns null without reading the selection when the source is not the document editor', () => {
    const current = vi.fn(() => snapshot);
    expect(getPendingSelectionSnapshot(hostWith(current), { source: 'pdf', documentId: 'doc-1' })).toBeNull();
    expect(getPendingSelectionSnapshot(hostWith(current), null)).toBeNull();
    expect(current).not.toHaveBeenCalled();
  });

  it('returns null without reading the selection when the selection and editor documents differ or are missing', () => {
    const current = vi.fn(() => snapshot);
    expect(getPendingSelectionSnapshot(hostWith(current), { ...editorSelection, documentId: 'doc-2' })).toBeNull();
    expect(getPendingSelectionSnapshot(hostWith(current), { source: 'document-editor' })).toBeNull();
    expect(getPendingSelectionSnapshot(hostWith(current, null), editorSelection)).toBeNull();
    expect(getPendingSelectionSnapshot({}, editorSelection)).toBeNull();
    expect(getPendingSelectionSnapshot(null, editorSelection)).toBeNull();
    expect(current).not.toHaveBeenCalled();
  });

  it('returns null when the selection reader is missing or reading it throws', () => {
    expect(getPendingSelectionSnapshot(hostWith(undefined), editorSelection)).toBeNull();
    const throwingDoc: PendingSelectionHost = {
      activeEditor: {
        options: { documentId: 'doc-1' },
        doc: {
          get selection(): { current?: () => unknown } {
            throw new Error('document unavailable');
          },
        },
      },
    };
    expect(getPendingSelectionSnapshot(throwingDoc, editorSelection)).toBeNull();
  });

  it('returns null when the selection read throws synchronously', () => {
    const current = vi.fn(() => {
      throw new Error('selection unavailable');
    });
    expect(getPendingSelectionSnapshot(hostWith(current), editorSelection)).toBeNull();
  });

  it('resolves an async snapshot and turns a rejection into null', async () => {
    const resolved = getPendingSelectionSnapshot(
      hostWith(async () => snapshot),
      editorSelection,
    );
    expect(resolved).toBeInstanceOf(Promise);
    expect(await resolved).toBe(snapshot);

    const rejected = getPendingSelectionSnapshot(
      hostWith(async () => {
        throw new Error('snapshot unavailable');
      }),
      editorSelection,
    );
    expect(rejected).toBeInstanceOf(Promise);
    expect(await rejected).toBeNull();
  });

  it('wraps a non-native thenable in a promise that never rejects', async () => {
    const thenable = {
      then: (_resolve: (value: unknown) => void, reject: (reason: unknown) => void) => reject(new Error('lost')),
    };
    const result = getPendingSelectionSnapshot(
      hostWith(() => thenable),
      editorSelection,
    );
    expect(result).toBeInstanceOf(Promise);
    expect(result).not.toBe(thenable);
    expect(await result).toBeNull();
  });
});

describe('getPendingSelectionSnapshot thenable detection', () => {
  it('reads then through the prototype and does not wrap primitives or then-less objects', () => {
    const inherited = Object.create({ then: (resolve: (value: unknown) => void) => resolve(snapshot) });
    expect(
      getPendingSelectionSnapshot(
        hostWith(() => inherited),
        editorSelection,
      ),
    ).toBeInstanceOf(Promise);
    expect(
      getPendingSelectionSnapshot(
        hostWith(() => 'text'),
        editorSelection,
      ),
    ).toBe('text');
    expect(
      getPendingSelectionSnapshot(
        hostWith(() => 0),
        editorSelection,
      ),
    ).toBe(0);
    const withThenValue = { then: 'not callable' };
    expect(
      getPendingSelectionSnapshot(
        hostWith(() => withThenValue),
        editorSelection,
      ),
    ).toBe(withThenValue);
  });

  it('returns null when reading then throws', () => {
    const hostile = {
      get then(): unknown {
        throw new Error('then unavailable');
      },
    };
    expect(
      getPendingSelectionSnapshot(
        hostWith(() => hostile),
        editorSelection,
      ),
    ).toBeNull();
  });
});
