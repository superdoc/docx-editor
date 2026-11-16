import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { StoryLocator } from '@superdoc/document-api';
import type { LooseRecord } from './loose-record.js';
import { EMPTY_SELECTION } from './selection-targets.js';
import type { SelectionSlice, TrackChangeInfo, TrackChangesItem } from './types.js';
import { createViewportPointQueries, type ViewportPointQueriesDeps } from './viewport-point-queries.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function boxAt(left: number, top: number, right: number, bottom: number): () => DOMRect {
  return () => new DOMRect(left, top, right - left, bottom - top);
}

function pointAt(hit: Element | null, stacked: Element[] = []): void {
  const originalSingle = document.elementFromPoint;
  const originalStacked = document.elementsFromPoint;
  document.elementFromPoint = () => hit;
  document.elementsFromPoint = () => stacked;
  cleanups.push(() => {
    document.elementFromPoint = originalSingle;
    document.elementsFromPoint = originalStacked;
  });
}

function mountedContainer(): HTMLElement {
  const container = document.createElement('div');
  container.getBoundingClientRect = boxAt(0, 0, 100, 100);
  document.body.appendChild(container);
  cleanups.push(() => container.remove());
  return container;
}

function trackItem(id: string, story?: StoryLocator): TrackChangesItem {
  const change: TrackChangeInfo = {
    id,
    type: 'insert',
    handle: { ref: `trackedChange:${id}`, refStability: 'stable', targetKind: 'trackedChange' },
    address: { kind: 'entity', entityType: 'trackedChange', entityId: id, ...(story ? { story } : {}) },
  };
  return { ...change, change };
}

const readySelection: SelectionSlice = { ...EMPTY_SELECTION, status: 'ready', tableSelection: null };

function queriesFor(overrides: Partial<ViewportPointQueriesDeps> & { editor?: LooseRecord | null } = {}) {
  const { editor = null, ...rest } = overrides;
  return createViewportPointQueries({
    superdoc: {},
    getEditor: () => editor,
    isDisposed: () => false,
    contentToken: () => 'token',
    computeSelection: () => readySelection,
    readPublicTrackChangeItems: () => [],
    readAllStoryTrackChanges: () => null,
    decorationOwnerForProvider: () => null,
    ...rest,
  });
}

describe('resolveVisibleHost', () => {
  it('prefers the editor mount container, then the SuperDoc root, then nothing', () => {
    const mount = mountedContainer();
    const root = mountedContainer();
    expect(
      queriesFor({ superdoc: { element: root }, editor: { mount: { container: mount } } }).resolveVisibleHost(),
    ).toBe(mount);
    expect(queriesFor({ superdoc: { element: root }, editor: { mount: 'not-a-mount' } }).resolveVisibleHost()).toBe(
      root,
    );
    expect(queriesFor({ superdoc: { element: 'not-an-element' } }).resolveVisibleHost()).toBeNull();
  });

  it('reads the active editor on every call', () => {
    const first = mountedContainer();
    const second = mountedContainer();
    let editor: LooseRecord = { mount: { container: first } };
    const queries = createViewportPointQueries({
      superdoc: {},
      getEditor: () => editor,
      isDisposed: () => false,
      contentToken: () => 'token',
      computeSelection: () => readySelection,
      readPublicTrackChangeItems: () => [],
      readAllStoryTrackChanges: () => null,
      decorationOwnerForProvider: () => null,
    });
    expect(queries.resolveVisibleHost()).toBe(first);
    editor = { mount: { container: second } };
    expect(queries.resolveVisibleHost()).toBe(second);
  });
});

describe('pointHitElements', () => {
  it('keeps only host-scoped, de-duplicated stacked elements after the primary hit', () => {
    const container = mountedContainer();
    const run = document.createElement('span');
    const block = document.createElement('p');
    block.appendChild(run);
    container.appendChild(block);
    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    cleanups.push(() => elsewhere.remove());
    pointAt(run, [run, elsewhere, block, block]);

    const point = queriesFor({ editor: { mount: { container } } }).pointHitElements(5, 6);
    expect(point).toEqual({ container, elements: [run, block], x: 5, y: 6 });
  });

  it('fails closed for non-finite points and hits outside the host', () => {
    const container = mountedContainer();
    const queries = queriesFor({ editor: { mount: { container } } });
    expect(queries.pointHitElements(Number.NaN, 1)).toBeNull();
    expect(queries.pointHitElements('1', 1)).toBeNull();
    pointAt(document.body);
    expect(queries.pointHitElements(1, 1)).toBeNull();
  });
});

describe('entityAt', () => {
  it('walks a pointer-inert tracked-change marker before the primary chain', () => {
    const container = mountedContainer();
    const block = document.createElement('p');
    block.setAttribute('data-comment-ids', 'c-1');
    const marker = document.createElement('span');
    marker.setAttribute('data-track-change-marker', '');
    marker.setAttribute('data-track-change-id', 'tc-1');
    marker.getBoundingClientRect = boxAt(0, 0, 20, 20);
    block.appendChild(marker);
    container.appendChild(block);
    pointAt(block);

    const queries = queriesFor({
      editor: { mount: { container } },
      readPublicTrackChangeItems: () => [trackItem('tc-1')],
    });
    expect(queries.entityAt({ x: 10, y: 10 })).toEqual([
      { type: 'trackedChange', id: 'tc-1' },
      { type: 'comment', id: 'c-1' },
    ]);
  });

  it('skips markers whose box does not contain the point', () => {
    const container = mountedContainer();
    const block = document.createElement('p');
    const marker = document.createElement('span');
    marker.setAttribute('data-track-change-marker', '');
    marker.setAttribute('data-track-change-id', 'tc-1');
    marker.getBoundingClientRect = boxAt(50, 50, 60, 60);
    block.appendChild(marker);
    container.appendChild(block);
    pointAt(block);

    const queries = queriesFor({
      editor: { mount: { container } },
      readPublicTrackChangeItems: () => [trackItem('tc-1')],
    });
    expect(queries.entityAt({ x: 10, y: 10 })).toEqual([]);
  });

  it('reads all-story items once, only for story hits, and drops them while unsettled', () => {
    const container = mountedContainer();
    const first = document.createElement('span');
    first.setAttribute('data-track-change-id', 'fn-tc');
    first.setAttribute('data-story-key', 'fn:fn-1');
    const second = document.createElement('span');
    second.setAttribute('data-track-change-id', 'fn-other');
    second.setAttribute('data-story-key', 'fn:fn-1');
    container.append(first, second);
    pointAt(first, [second]);

    const story: StoryLocator = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' };
    const readAllStoryTrackChanges = vi.fn(() => [trackItem('fn-tc', story)]);
    const queries = queriesFor({ editor: { mount: { container } }, readAllStoryTrackChanges });
    expect(queries.entityAt({ x: 1, y: 1 })).toEqual([{ type: 'trackedChange', id: 'fn-tc', story }]);
    expect(readAllStoryTrackChanges).toHaveBeenCalledTimes(1);

    expect(
      queriesFor({ editor: { mount: { container } }, readAllStoryTrackChanges: () => null }).entityAt({ x: 1, y: 1 }),
    ).toEqual([]);
  });

  it('maps decoration providers to their owner and drops unowned ones', () => {
    const container = mountedContainer();
    const owned = document.createElement('span');
    owned.setAttribute('data-superdoc-extension-decoration', 'provider-1');
    const unowned = document.createElement('span');
    unowned.setAttribute('data-superdoc-extension-decoration', 'provider-2');
    container.append(owned, unowned);
    pointAt(owned, [unowned]);

    const queries = queriesFor({
      editor: { mount: { container } },
      decorationOwnerForProvider: (id) => (id === 'provider-1' ? { id: 'highlight-1' } : null),
    });
    expect(queries.entityAt({ x: 1, y: 1 })).toEqual([{ type: 'decoration', id: 'highlight-1' }]);
  });

  it('returns null for the number form and [] for a null object form', () => {
    const queries = queriesFor();
    expect(queries.entityAt(1, 2)).toBeNull();
    expect(Reflect.apply(queries.entityAt, undefined, [null])).toEqual([]);
  });
});

describe('positionAt', () => {
  function positionQueries(getTargetAtPoint: (input: unknown) => Promise<unknown>) {
    const container = mountedContainer();
    let token = 'token-1';
    let disposed = false;
    const editor: LooseRecord = { mount: { container }, viewportQuery: { getTargetAtPoint } };
    const queries = queriesFor({
      editor,
      contentToken: () => token,
      isDisposed: () => disposed,
    });
    return {
      queries,
      setToken: (next: string) => {
        token = next;
      },
      dispose: () => {
        disposed = true;
      },
    };
  }

  const textPoint = { kind: 'text', blockId: 'p-1', offset: 2 };

  it('returns a validated selection target', async () => {
    const target = { kind: 'selection', start: textPoint, end: textPoint };
    const { queries } = positionQueries(async () => ({ status: 'resolved', target }));
    await expect(queries.positionAt({ x: 10, y: 10 })).resolves.toEqual({ status: 'resolved', target });
  });

  it('reports a content change during the query as stale, and disposal as disposed', async () => {
    const stale = positionQueries(async () => {
      stale.setToken('token-2');
      return { status: 'no-target' };
    });
    await expect(stale.queries.positionAt({ x: 10, y: 10 })).resolves.toEqual({ status: 'stale' });

    const disposed = positionQueries(async () => {
      disposed.dispose();
      return { status: 'no-target' };
    });
    await expect(disposed.queries.positionAt({ x: 10, y: 10 })).resolves.toEqual({ status: 'disposed' });
  });

  it('rejects points outside the host and invalid host results', async () => {
    const { queries } = positionQueries(async () => ({ status: 'resolved', target: { kind: 'selection' } }));
    await expect(queries.positionAt({ x: 500, y: 10 })).resolves.toEqual({ status: 'no-target' });
    await expect(queries.positionAt({ x: 10, y: 10 })).rejects.toThrow('invalid target');
  });

  it('is unavailable without a host point query', async () => {
    const container = mountedContainer();
    await expect(queriesFor({ editor: { mount: { container } } }).positionAt({ x: 1, y: 1 })).resolves.toEqual({
      status: 'unavailable',
    });
  });
});

describe('contextAt', () => {
  it('copies the point, and clears the table selection unless the selection is ready', () => {
    const container = mountedContainer();
    pointAt(null);
    const pending: SelectionSlice = { ...readySelection, status: 'pending', tableSelection: undefined };
    const input = { x: 10, y: 20 };
    const context = queriesFor({
      editor: { mount: { container }, viewportQuery: { isPointInPaintedSelection: () => true } },
      computeSelection: () => pending,
    }).contextAt(input);
    input.x = 99;
    expect(context.point).toEqual({ x: 10, y: 20 });
    expect(context.selection).toEqual({ ...pending, tableSelection: null });
    expect(Object.keys(context.selection)).toContain('tableSelection');
    expect(context.insideSelection).toBe(true);
    expect(context.position).toBeNull();
  });

  it('treats a throwing painted-selection probe and invalid input as outside the selection', () => {
    const container = mountedContainer();
    pointAt(null);
    const queries = queriesFor({
      editor: {
        mount: { container },
        viewportQuery: {
          isPointInPaintedSelection: () => {
            throw new Error('probe failed');
          },
        },
      },
    });
    expect(queries.contextAt({ x: 1, y: 1 }).insideSelection).toBe(false);
    const invalid: unknown = Reflect.apply(queries.contextAt, undefined, [null]);
    expect(invalid).toMatchObject({ point: { x: 0, y: 0 }, entities: [], insideSelection: false });
  });
});
