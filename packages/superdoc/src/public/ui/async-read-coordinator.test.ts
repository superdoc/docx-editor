import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type {
  AnchoredMetadataResolveInfo,
  CommentsListResult,
  ContentControlInfo,
  ContentControlsListResult,
  SelectionInfo,
  TrackChangesListResult,
} from '@superdoc/document-api';

import type { PartialBrowserDocumentApi } from '../browser-document-api.js';
import { createSuperDocUI } from './create-super-doc-ui.js';

type SourceStage = 'source-loading' | 'source-complete';
type Read<T> = () => T | Promise<T>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function unsettled<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function rangeSelection(start: number, end: number, text = 'hello'): SelectionInfo {
  return {
    empty: false,
    target: { kind: 'text', segments: [{ blockId: 'P1', range: { start, end } }] },
    selectionTarget: {
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: start },
      end: { kind: 'text', blockId: 'P1', offset: end },
    },
    activeMarks: [],
    activeCommentIds: [],
    activeChangeIds: [],
    text,
  };
}

function caretSelection(offset: number, activeMarks: string[] = []): SelectionInfo {
  return {
    empty: true,
    target: null,
    selectionTarget: {
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset },
      end: { kind: 'text', blockId: 'P1', offset },
    },
    activeMarks,
    activeCommentIds: [],
    activeChangeIds: [],
  };
}

function hostSelection(anchor: number, focus = anchor) {
  return { anchor: { blockId: 'P1', blockOffset: anchor }, focus: { blockId: 'P1', blockOffset: focus } };
}

function commentRows(...commentIds: string[]): CommentsListResult {
  return {
    evaluatedRevision: 'r1',
    total: commentIds.length,
    items: commentIds.map((id) => ({
      id,
      handle: { ref: `comment:${id}`, refStability: 'stable', targetKind: 'comment' },
      address: { kind: 'entity', entityType: 'comment', entityId: id },
      status: 'open',
    })),
    page: { limit: commentIds.length, offset: 0, returned: commentIds.length },
  };
}

function contentControlRows(...controlIds: string[]): ContentControlsListResult {
  const items: ContentControlInfo[] = controlIds.map((id) => ({
    nodeType: 'sdt',
    kind: 'inline',
    id,
    controlType: 'text',
    lockMode: 'unlocked',
    properties: {},
    target: { kind: 'inline', nodeType: 'sdt', nodeId: id },
  }));
  return { items, total: items.length };
}

const NO_TRACKED_CHANGES: TrackChangesListResult = {
  evaluatedRevision: 'r1',
  total: 0,
  items: [],
  page: { limit: 0, offset: 0, returned: 0 },
};

type TestDoc = PartialBrowserDocumentApi & {
  format?: { readEffectiveInlineUniformity?: (input: unknown) => unknown };
};

interface EditorOptions {
  stage?: SourceStage;
  foregroundProbe?: boolean;
  selectionCurrent?: Read<SelectionInfo>;
  syncSelection?: () => unknown;
  commentsList?: Read<CommentsListResult>;
  contentControlsList?: Read<ContentControlsListResult>;
  metadataResolve?: Read<AnchoredMetadataResolveInfo | null>;
  readEffectiveInlineUniformity?: (input: unknown) => unknown;
  onLoadingDetach?: () => void;
}

function makeEditor(options: EditorOptions = {}) {
  let foreground = { active: 0, pending: 0 };
  const selectionListeners: Array<(snapshot: unknown) => void> = [];
  const eventListeners: Array<(event: Record<string, unknown>) => void> = [];
  const selectionCurrent = vi.fn(options.selectionCurrent ?? (() => rangeSelection(0, 5)));
  const commentsList = vi.fn(options.commentsList ?? (() => commentRows('c-1')));
  const contentControlsList = vi.fn(options.contentControlsList ?? (() => contentControlRows('cc-1')));
  const metadataResolve = vi.fn(options.metadataResolve ?? (() => null));
  const readEffectiveInlineUniformity = vi.fn(options.readEffectiveInlineUniformity ?? (() => null));
  const emit = (event: Record<string, unknown>): void => {
    for (const listener of [...eventListeners]) listener(event);
  };
  const doc: TestDoc = {
    selection: { current: selectionCurrent },
    comments: { list: commentsList },
    trackChanges: { list: () => NO_TRACKED_CHANGES },
    contentControls: { list: contentControlsList, listInRange: () => contentControlRows() },
    metadata: { resolve: metadataResolve },
    ...(options.readEffectiveInlineUniformity ? { format: { readEffectiveInlineUniformity } } : {}),
  };
  const editor = {
    doc,
    host: {
      getHandles: () => ({
        editing: {
          selection: {
            subscribe: (listener: (snapshot: unknown) => void) => {
              selectionListeners.push(listener);
              return () => {
                const index = selectionListeners.indexOf(listener);
                if (index >= 0) selectionListeners.splice(index, 1);
              };
            },
          },
        },
      }),
      readLiveSelectionSyncSnapshot:
        options.syncSelection ?? (() => ({ empty: true, target: null, selectionTarget: null })),
      getDocumentLoadingSnapshot: () => ({ sourceStage: options.stage ?? 'source-complete' }),
      subscribeDocumentLoading: () => () => options.onLoadingDetach?.(),
      events: {
        subscribe: (listener: (event: Record<string, unknown>) => void) => {
          eventListeners.push(listener);
          return () => undefined;
        },
      },
      ...(options.foregroundProbe ? { getForegroundMutationState: () => ({ ...foreground }) } : {}),
    },
  };
  return {
    editor,
    selectionCurrent,
    commentsList,
    contentControlsList,
    metadataResolve,
    readEffectiveInlineUniformity,
    setForeground: (next: { active: number; pending: number }) => {
      foreground = next;
    },
    emitSelection: (snapshot: unknown) => {
      for (const listener of [...selectionListeners]) listener(snapshot);
    },
    emitMutation: () => emit({ type: 'mutation:committed', origin: 'command' }),
    emitTypingMutation: () =>
      emit({ type: 'mutation:committed', origin: 'command', editableCommandKind: 'insert-text' }),
  };
}

type TestEditor = ReturnType<typeof makeEditor>;

function mountController(first: TestEditor) {
  const handlers = new Map<string, Set<() => void>>();
  const superdoc = {
    activeEditor: first.editor,
    config: { documentMode: 'editing' },
    on: (event: string, handler: () => void) => {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
    },
    off: (event: string, handler: () => void) => {
      handlers.get(event)?.delete(handler);
    },
  };
  const emit = (event: string): void => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler();
  };
  const ui = createSuperDocUI({ superdoc });
  return {
    ui,
    emit,
    switchTo: (next: TestEditor) => {
      superdoc.activeEditor = next.editor;
      emit('active-editor-change');
    },
  };
}

type BenchEvent = Record<string, unknown>;

function installBenchSink(): { events: BenchEvent[]; remove: () => void } {
  const benchGlobal: typeof globalThis & { __superdocV2BenchPipelineTiming?: (event: BenchEvent) => void } = globalThis;
  const events: BenchEvent[] = [];
  benchGlobal.__superdocV2BenchPipelineTiming = (event) => events.push(event);
  return {
    events,
    remove: () => {
      delete benchGlobal.__superdocV2BenchPipelineTiming;
    },
  };
}

function settledKeys(event: BenchEvent): string[] {
  const settlements = event.asyncReadSettlements;
  if (!Array.isArray(settlements)) return [];
  return settlements.flatMap((settlement: unknown) =>
    settlement && typeof settlement === 'object' && 'key' in settlement && typeof settlement.key === 'string'
      ? [settlement.key]
      : [],
  );
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

async function settle(ms = 600): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flushMicrotasks();
}

const ids = (items: readonly unknown[]): unknown[] =>
  items.map((item) => (item && typeof item === 'object' && 'id' in item ? item.id : null));

afterEach(() => {
  vi.useRealTimers();
});

describe('async read coordinator lifecycle', () => {
  it('issues one read per key and token across repeated recomputes', async () => {
    vi.useFakeTimers();
    const comments = deferred<CommentsListResult>();
    const editor = makeEditor({ commentsList: () => comments.promise });
    const { ui, emit } = mountController(editor);
    expect(editor.commentsList).toHaveBeenCalledTimes(1);

    emit('zoomChange');
    emit('zoomChange');
    emit('zoomChange');
    await flushMicrotasks();
    expect(editor.commentsList).toHaveBeenCalledTimes(1);
    expect(ui.comments.getSnapshot().listStatus).toBe('pending');

    comments.resolve(commentRows('c-1'));
    await flushMicrotasks();
    emit('zoomChange');
    expect(ui.comments.getSnapshot()).toMatchObject({ listStatus: 'ready', total: 1 });
    expect(editor.commentsList).toHaveBeenCalledTimes(1);
    ui.destroy();
  });

  it('debounces a distinct large-selection uniformity read and serves the first one immediately', async () => {
    vi.useFakeTimers();
    let selection = rangeSelection(0, 5);
    const editor = makeEditor({
      selectionCurrent: () => selection,
      readEffectiveInlineUniformity: () => ({
        success: true,
        values: { fontFamily: { state: 'uniform', value: 'Cambria' } },
      }),
    });
    const { ui } = mountController(editor);
    expect(editor.readEffectiveInlineUniformity).toHaveBeenCalledTimes(1);

    selection = rangeSelection(6, 11);
    editor.emitSelection(hostSelection(6, 11));
    await vi.advanceTimersByTimeAsync(100);
    selection = rangeSelection(12, 17);
    editor.emitSelection(hostSelection(12, 17));
    await vi.advanceTimersByTimeAsync(179);
    expect(editor.readEffectiveInlineUniformity).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(editor.readEffectiveInlineUniformity).toHaveBeenCalledTimes(2);
    expect(editor.readEffectiveInlineUniformity.mock.calls[1]?.[0]).toMatchObject({
      target: rangeSelection(12, 17).selectionTarget,
    });

    await settle(1_000);
    expect(editor.readEffectiveInlineUniformity).toHaveBeenCalledTimes(2);
    ui.destroy();
  });

  it('comments catalog demand cold-starts once and then defers to the typing hold', async () => {
    vi.useFakeTimers();
    const editor = makeEditor({ stage: 'source-loading' });
    const { ui } = mountController(editor);
    await settle();
    expect(editor.commentsList).toHaveBeenCalledTimes(0);
    expect(editor.contentControlsList).toHaveBeenCalledTimes(0);

    ui.comments.list();
    ui.comments.list();
    ui.contentControls.list();
    await settle();
    expect(editor.commentsList).toHaveBeenCalledTimes(1);
    expect(editor.contentControlsList).toHaveBeenCalledTimes(1);

    editor.emitTypingMutation();
    await settle();
    ui.comments.list();
    ui.contentControls.list();
    await settle(2_000);
    expect(editor.commentsList).toHaveBeenCalledTimes(1);
    expect(editor.contentControlsList).toHaveBeenCalledTimes(2);
    expect(ui.comments.getSnapshot()).toMatchObject({ listStatus: 'stale', total: 1 });
    ui.destroy();
  });

  it('clears every coordinator timer on destroy', async () => {
    vi.useFakeTimers();
    let selection = rangeSelection(0, 5);
    const editor = makeEditor({
      foregroundProbe: true,
      selectionCurrent: () => selection,
      metadataResolve: () => Promise.reject(new Error('metadata unavailable')),
      readEffectiveInlineUniformity: () => ({ success: true, values: {} }),
    });
    const { ui } = mountController(editor);
    const notifications = vi.fn();
    ui.select((state) => state, Object.is).subscribe(notifications);
    await settle(1_000);
    const baseline = vi.getTimerCount();

    ui.metadata.getRect({ id: 'm-1' });
    await settle(200);
    ui.metadata.getRect({ id: 'm-1' });
    await flushMicrotasks();
    expect(editor.metadataResolve).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount(), 'failure backoff').toBe(baseline + 1);

    editor.emitTypingMutation();
    expect(vi.getTimerCount(), 'typing invalidation').toBe(baseline + 2);

    editor.emitMutation();
    expect(vi.getTimerCount(), 'idle release').toBe(baseline + 3);

    selection = rangeSelection(6, 11);
    editor.emitSelection(hostSelection(6, 11));
    expect(vi.getTimerCount(), 'effective-inline debounce').toBe(baseline + 4);

    editor.setForeground({ active: 1, pending: 0 });
    editor.emitSelection(hostSelection(12, 17));
    expect(vi.getTimerCount(), 'foreground retry').toBe(baseline + 5);

    ui.destroy();
    expect(vi.getTimerCount()).toBe(baseline);

    notifications.mockClear();
    for (const read of [
      editor.selectionCurrent,
      editor.commentsList,
      editor.contentControlsList,
      editor.metadataResolve,
      editor.readEffectiveInlineUniformity,
    ]) {
      read.mockClear();
    }
    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();
    expect(notifications).not.toHaveBeenCalled();
    expect(editor.selectionCurrent).not.toHaveBeenCalled();
    expect(editor.commentsList).not.toHaveBeenCalled();
    expect(editor.contentControlsList).not.toHaveBeenCalled();
    expect(editor.metadataResolve).not.toHaveBeenCalled();
    expect(editor.readEffectiveInlineUniformity).not.toHaveBeenCalled();
  });

  it('keeps answering cached reads after destroy', async () => {
    vi.useFakeTimers();
    const editor = makeEditor({
      selectionCurrent: () => Promise.resolve(rangeSelection(0, 5, 'cached')),
      commentsList: () => Promise.resolve(commentRows('c-cached')),
    });
    const { ui } = mountController(editor);
    await settle();
    expect(ui.selection.current()).toMatchObject({ text: 'cached' });

    ui.destroy();
    editor.selectionCurrent.mockClear();
    editor.commentsList.mockClear();

    expect(ui.selection.current()).toMatchObject({ text: 'cached' });
    expect(ids(ui.comments.list())).toEqual(['c-cached']);
    expect(editor.selectionCurrent).not.toHaveBeenCalled();
    expect(editor.commentsList).not.toHaveBeenCalled();
  });

  it('drops cached reads, demand and holds when the active editor changes', async () => {
    vi.useFakeTimers();
    const first = makeEditor({
      stage: 'source-loading',
      contentControlsList: () => contentControlRows('cc-first'),
      metadataResolve: () => Promise.reject(new Error('metadata unavailable')),
    });
    const second = makeEditor({ selectionCurrent: unsettled, commentsList: unsettled, contentControlsList: unsettled });
    const { ui, switchTo } = mountController(first);

    ui.contentControls.list();
    await flushMicrotasks();
    expect(first.contentControlsList).toHaveBeenCalledTimes(1);
    expect(ids(ui.state.contentControls.items)).toEqual(['cc-first']);

    first.emitMutation();
    ui.metadata.getRect({ id: 'm-1' });
    await flushMicrotasks();
    expect(first.metadataResolve).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount(), 'failure backoff armed for the first editor').toBe(1);

    switchTo(second);
    expect(second.commentsList, 'heavy-read hold reset').toHaveBeenCalledTimes(1);
    expect(second.contentControlsList, 'heavy-read hold reset').toHaveBeenCalledTimes(1);
    expect(ui.state.contentControls.items, 'demanded catalog value dropped').toEqual([]);
    expect(vi.getTimerCount(), 'failure backoff cleared').toBe(0);
    ui.destroy();
  });

  it('does not carry content-controls demand back to a still-loading editor', async () => {
    vi.useFakeTimers();
    const first = makeEditor({ stage: 'source-loading' });
    const second = makeEditor({ stage: 'source-loading' });
    const { ui, switchTo } = mountController(first);
    ui.contentControls.list();
    await settle();
    expect(first.contentControlsList).toHaveBeenCalledTimes(1);

    switchTo(second);
    await settle();
    switchTo(first);
    await settle();
    expect(first.contentControlsList, 'demand dropped on editor change').toHaveBeenCalledTimes(1);
    ui.destroy();
  });

  it('drops a stale completion for a non-selection key', async () => {
    vi.useFakeTimers();
    const reads = [deferred<CommentsListResult>(), deferred<CommentsListResult>()];
    let call = 0;
    const editor = makeEditor({ commentsList: () => reads[call++]?.promise ?? unsettled() });
    const { ui } = mountController(editor);
    editor.emitMutation();
    expect(editor.commentsList).toHaveBeenCalledTimes(2);

    reads[1]?.resolve(commentRows('c-new'));
    await flushMicrotasks();
    reads[0]?.resolve(commentRows('c-old'));
    await flushMicrotasks();

    expect(ui.comments.getSnapshot().listStatus).toBe('ready');
    expect(ids(ui.comments.getSnapshot().items)).toEqual(['c-new']);
    ui.destroy();
  });

  it('keeps a failed read stale and backs off instead of re-issuing it', async () => {
    vi.useFakeTimers();
    let fail = false;
    const editor = makeEditor({
      commentsList: () => (fail ? Promise.reject(new Error('worker busy')) : Promise.resolve(commentRows('c-1'))),
    });
    const { ui, emit } = mountController(editor);
    await flushMicrotasks();
    expect(ui.comments.getSnapshot().listStatus).toBe('ready');

    fail = true;
    editor.emitMutation();
    await flushMicrotasks();
    expect(editor.commentsList).toHaveBeenCalledTimes(2);
    expect(ui.comments.getSnapshot()).toMatchObject({ listStatus: 'stale', total: 1 });

    emit('zoomChange');
    emit('zoomChange');
    await vi.advanceTimersByTimeAsync(249);
    expect(editor.commentsList).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    expect(editor.commentsList).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(499);
    expect(editor.commentsList).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(editor.commentsList).toHaveBeenCalledTimes(4);
    expect(ids(ui.comments.getSnapshot().items)).toEqual(['c-1']);
    ui.destroy();
  });

  it('lets an outstanding authoritative read win over a non-deferred caret seed', async () => {
    vi.useFakeTimers();
    const reads: Array<Deferred<SelectionInfo>> = [];
    let caret = caretSelection(0);
    const editor = makeEditor({
      selectionCurrent: () => {
        const read = deferred<SelectionInfo>();
        reads.push(read);
        return read.promise;
      },
      syncSelection: () => caret,
    });
    const { ui } = mountController(editor);

    caret = caretSelection(1);
    editor.emitSelection(hostSelection(1));
    expect(reads).toHaveLength(2);
    expect(ui.state.selection).toMatchObject({ status: 'ready', activeMarks: [] });
    expect(ui.state.selection.selectionTarget).toMatchObject({ start: { offset: 1 } });

    reads[1]?.resolve(caretSelection(1, ['bold']));
    await flushMicrotasks();
    expect(ui.state.selection).toMatchObject({ status: 'ready', activeMarks: ['bold'] });
    ui.destroy();
  });

  it('drops an outstanding read once a deferred caret seed supersedes it', async () => {
    vi.useFakeTimers();
    const reads: Array<Deferred<SelectionInfo>> = [];
    let caret = caretSelection(0);
    const editor = makeEditor({
      foregroundProbe: true,
      selectionCurrent: () => {
        const read = deferred<SelectionInfo>();
        reads.push(read);
        return read.promise;
      },
      syncSelection: () => caret,
    });
    const { ui } = mountController(editor);
    await settle();
    reads[0]?.resolve(caretSelection(0));
    await settle();

    caret = caretSelection(1);
    editor.emitSelection(hostSelection(1));
    const outstanding = reads.at(-1);
    expect(reads).toHaveLength(2);

    editor.setForeground({ active: 1, pending: 0 });
    caret = caretSelection(2);
    editor.emitSelection(hostSelection(2));
    expect(reads).toHaveLength(2);

    outstanding?.resolve(caretSelection(1, ['bold']));
    await flushMicrotasks();
    expect(ui.state.selection.activeMarks).toEqual([]);
    expect(ui.state.selection.selectionTarget).toMatchObject({ start: { offset: 2 }, end: { offset: 2 } });
    ui.destroy();
  });

  it('ignores a read from the previous editor that settles after the editor changes', async () => {
    vi.useFakeTimers();
    const firstRead = deferred<SelectionInfo>();
    const first = makeEditor({ selectionCurrent: () => firstRead.promise });
    const second = makeEditor({ selectionCurrent: unsettled });
    const { ui, switchTo } = mountController(first);

    switchTo(second);
    expect(second.selectionCurrent).toHaveBeenCalledTimes(1);
    firstRead.resolve(rangeSelection(0, 5, 'from-first-editor'));
    await flushMicrotasks();

    expect(ui.state.selection.status).toBe('pending');
    expect(ui.state.selection.quotedText).toBe('');
    ui.destroy();
  });

  it('does not carry a typed-caret validation hold into a new editor', async () => {
    vi.useFakeTimers();
    let caret = caretSelection(0);
    const first = makeEditor({ foregroundProbe: true, selectionCurrent: () => caret, syncSelection: () => caret });
    const second = makeEditor({ selectionCurrent: unsettled });
    const { ui, switchTo } = mountController(first);
    await settle();

    first.setForeground({ active: 1, pending: 0 });
    first.emitTypingMutation();
    caret = caretSelection(1);
    first.emitSelection(hostSelection(1));

    switchTo(second);
    expect(second.selectionCurrent).toHaveBeenCalledTimes(1);
    ui.destroy();
  });

  it('lets a loading-subscription detacher observe the cleared cache and caret hold during an editor change', async () => {
    vi.useFakeTimers();
    const seen: Array<{ value: unknown; secondReads: number }> = [];
    const reentry = { read: (): unknown => undefined };
    let caret = caretSelection(0);
    const first = makeEditor({
      stage: 'source-loading',
      foregroundProbe: true,
      selectionCurrent: () => caret,
      syncSelection: () => caret,
      onLoadingDetach: () =>
        seen.push({ value: reentry.read(), secondReads: second.selectionCurrent.mock.calls.length }),
    });
    const second = makeEditor({ selectionCurrent: unsettled });
    const { ui, switchTo } = mountController(first);
    reentry.read = () => ui.selection.current();
    await settle();

    first.setForeground({ active: 1, pending: 0 });
    first.emitTypingMutation();
    caret = caretSelection(1);
    first.emitSelection(hostSelection(1));
    expect(ui.selection.current()).toMatchObject({ selectionTarget: { start: { offset: 1 } } });

    switchTo(second);
    expect(seen).toEqual([{ value: null, secondReads: 1 }]);
    ui.destroy();
  });

  it('runs the loading-subscription detacher after the coordinator timers are cleared on destroy', async () => {
    vi.useFakeTimers();
    const timersAtDetach: number[] = [];
    const editor = makeEditor({
      stage: 'source-loading',
      onLoadingDetach: () => timersAtDetach.push(vi.getTimerCount()),
    });
    const { ui } = mountController(editor);
    await settle();
    const baseline = vi.getTimerCount();

    editor.emitTypingMutation();
    expect(vi.getTimerCount()).toBe(baseline + 1);

    ui.destroy();
    expect(timersAtDetach).toEqual([baseline]);
  });

  it('settles two reads together with one coalesced recompute', async () => {
    vi.useFakeTimers();
    const sink = installBenchSink();
    try {
      const comments = deferred<CommentsListResult>();
      const contentControls = deferred<ContentControlsListResult>();
      const editor = makeEditor({
        commentsList: () => comments.promise,
        contentControlsList: () => contentControls.promise,
      });
      const { ui } = mountController(editor);
      sink.events.length = 0;

      comments.resolve(commentRows('c-1'));
      contentControls.resolve(contentControlRows('cc-1'));
      await flushMicrotasks();

      const settledRecomputes = sink.events.filter(
        (event) => event.stage === 'superdoc-ui-recompute' && event.reason === 'async-read-settled',
      );
      expect(settledRecomputes).toHaveLength(1);
      const drains = sink.events.filter((event) => settledKeys(event).length > 0);
      expect(drains).toHaveLength(1);
      expect(settledKeys(drains[0] ?? {}).sort()).toEqual(['comments', 'contentControls']);
      ui.destroy();
    } finally {
      sink.remove();
    }
  });

  it('records settled reads for the bench drain once', async () => {
    vi.useFakeTimers();
    const sink = installBenchSink();
    try {
      const comments = deferred<CommentsListResult>();
      const editor = makeEditor({ commentsList: () => comments.promise });
      const { ui, emit } = mountController(editor);

      comments.resolve(commentRows('c-1'));
      await flushMicrotasks();
      emit('zoomChange');
      emit('zoomChange');

      const computeStates = sink.events.filter((event) => event.stage === 'superdoc-ui-compute-state');
      expect(computeStates.filter((event) => settledKeys(event).includes('comments'))).toHaveLength(1);
      expect(sink.events.filter((event) => event.stage === 'superdoc-ui-async-read-settled')).toHaveLength(1);
      ui.destroy();
    } finally {
      sink.remove();
    }
  });
});
