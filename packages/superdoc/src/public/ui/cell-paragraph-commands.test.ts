import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { SelectionInfo, StoryLocator } from '@superdoc/document-api';
import {
  createSuperDocUI,
  executeFirstPartyCommandAsync,
  registerFirstPartyCommandMutation,
} from './create-super-doc-ui.js';
import { readRecord } from './loose-record.js';

const body: StoryLocator = { kind: 'story', storyType: 'body' };
const commands = [
  { id: 'text-align', payload: 'right', patch: { alignment: 'right' } },
  { id: 'line-height', payload: 1.5, patch: { line: 360, lineRule: 'auto' } },
  { id: 'linked-style', payload: 'FabricatedBody', patch: { styleId: 'FabricatedBody' } },
  { id: 'indent-increase', payload: undefined, patch: { left: 1440 } },
  { id: 'indent-decrease', payload: undefined, patch: { left: 0 } },
];
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function cellSelection(ids = ['cell-a', 'cell-c'], story = body): SelectionInfo {
  return {
    empty: false,
    target: null,
    selectionTarget: null,
    activeMarks: [],
    activeCommentIds: [],
    activeChangeIds: [],
    tableSelection: {
      kind: 'tableCells',
      tableId: 'inner-table',
      story,
      type: 'cells',
      selectionMode: 'cells',
      isRectangular: false,
      start: { rowIndex: 0, columnIndex: 0 },
      end: { rowIndex: 0, columnIndex: 2 },
      cells: ids.map((nodeId, columnIndex) => ({ nodeId, rowIndex: 0, columnIndex, rowspan: 1, colspan: 1 })),
    },
  };
}

function mount(initial = cellSelection(), pageLimit = 1) {
  let selection = initial;
  let notifySelection = () => {};
  let hostEvent = (_event: unknown) => {};
  let generation = 0;
  let mounted: object = {};
  const lifetime = new AbortController();
  const mutate = vi.fn((_input: unknown, _options?: unknown) => Promise.resolve({ success: true }));
  const indentRange = vi.fn(
    (_input: unknown, _options?: unknown): Promise<unknown> => Promise.resolve({ success: true }),
  );
  const paragraphs = new Map([
    [
      'cell-a',
      [
        { nodeId: 'A1', nodeType: 'paragraph' },
        { nodeId: 'A2', nodeType: 'paragraph' },
      ],
    ],
    ['cell-b', [{ nodeId: 'NEIGHBOR', nodeType: 'paragraph' }]],
    [
      'cell-c',
      [
        { nodeId: 'C1', nodeType: 'heading' },
        { nodeId: 'C2', nodeType: 'listItem' },
      ],
    ],
  ]);
  const directIndents = new Map<string, { left?: number; start?: number }>();
  const absentIndents = new Set<string>();
  const getCells = vi.fn(async () => ({
    nodeId: 'inner-table',
    address: { kind: 'block', nodeType: 'table', nodeId: 'inner-table', story: selection.tableSelection?.story },
    cells: [...paragraphs.keys()].map((nodeId) => ({
      nodeId,
      address: { kind: 'block', nodeType: 'tableCell', nodeId, story: initial.tableSelection?.story },
      firstParagraphNodeId: paragraphs.get(nodeId)?.[0]?.nodeId,
    })),
  }));
  const find = vi.fn(async (raw: unknown): Promise<unknown> => {
    const input = readRecord(raw);
    const within = readRecord(input?.within);
    const select = readRecord(input?.select);
    const cellId = within?.nodeId;
    if (readRecord(input?.options)?.includeResolved === true) {
      const node = [...paragraphs.values()].flat().find(({ nodeId }) => nodeId === cellId);
      const kind = node?.nodeType === 'heading' ? 'heading' : 'paragraph';
      const items =
        typeof cellId === 'string' && kind === select?.nodeType && (node || cellId === 'TEXT')
          ? [
              {
                address: { kind: 'block', nodeType: kind, nodeId: cellId, story: initial.tableSelection?.story },
                node: {
                  kind,
                  paragraphIds: { paraId: cellId },
                  [kind]: {
                    props: absentIndents.has(cellId)
                      ? {}
                      : { indent: { right: 6, firstLine: 2, ...directIndents.get(cellId) } },
                    resolved: absentIndents.has(cellId)
                      ? {}
                      : { indent: { left: 36, ...directIndents.get(cellId), right: 6, firstLine: 2 } },
                  },
                },
              },
            ]
          : [];
      return { total: items.length, offset: 0, limit: 2, items };
    }
    const owned =
      within?.nodeType === 'table' && cellId === initial.tableSelection?.tableId
        ? [...paragraphs.values()].flat()
        : typeof cellId === 'string'
          ? paragraphs.get(cellId)
          : undefined;
    if (!owned) throw new Error('TARGET_NOT_FOUND');
    const all = owned.filter((p) => p.nodeType === select?.nodeType);
    const offset = typeof input?.offset === 'number' ? input.offset : 0;
    return {
      total: all.length,
      offset,
      limit: pageLimit,
      items: all.slice(offset, offset + pageLimit).map((p) => ({
        address: { kind: 'block', ...p, story: initial.tableSelection?.story },
      })),
    };
  });
  const getState = vi.fn(async (_input: unknown) => ({ success: true, isListItem: false }));
  const getNode = vi.fn(async (_input: unknown) => ({
    node: { kind: 'paragraph', paragraph: { props: { indent: { left: 36, right: 6, firstLine: 2 } } } },
  }));
  const doc = {
    selection: { current: () => selection },
    tables: { getCells },
    find,
    getNode,
    getNodeById: getNode,
    format: {
      paragraph: { setAlignment: mutate, setSpacing: mutate, setIndentation: mutate, clearIndentation: mutate },
    },
    styles: { paragraph: { setStyle: mutate } },
    lists: {
      getState,
      getStateInStory: getState,
      indent: mutate,
      outdent: mutate,
      indentRange,
      outdentRange: indentRange,
    },
  };
  const host = {
    getHandles: () => ({
      selection: {
        apply: () => true,
        selectionRequestGeneration: () => generation,
        selectionRequestGate: () => 'open',
      },
      editing: {
        selection: {
          subscribe: (listener: () => void) => {
            notifySelection = listener;
            return () => {};
          },
        },
      },
    }),
    getForegroundInteractionLifetime: () => lifetime.signal,
    getMountedHandle: () => mounted,
    readLiveSelectionSyncSnapshot: () => selection,
    events: {
      subscribe: (listener: (event: unknown) => void) => {
        hostEvent = listener;
        return () => {};
      },
    },
  };
  const superdoc = {
    activeEditor: { editorVersion: 2 },
    config: { documentMode: 'editing' },
    on: vi.fn(),
    off: vi.fn(),
  };
  Object.assign(superdoc.activeEditor, { doc, host });
  const ui = createSuperDocUI({ superdoc });
  cleanups.push(() => ui.destroy());
  return {
    ui,
    doc,
    host,
    superdoc,
    mutate,
    indentRange,
    getCells,
    find,
    getState,
    getNode,
    directIndents,
    absentIndents,
    lifetime,
    paragraphs,
    select(next: SelectionInfo) {
      selection = next;
      notifySelection();
    },
    changeSource() {
      hostEvent({ type: 'collaboration:remote-changed' });
    },
    remount() {
      mounted = {};
    },
    invalidateRequest() {
      generation += 1;
    },
  };
}

describe('SD-7946 whole-cell paragraph commands', () => {
  it.each(commands)('enables and awaits $id for every exact cell paragraph', async ({ id, payload, patch }) => {
    const h = mount(cellSelection(['cell-a', 'cell-c', 'cell-a']));
    await vi.waitFor(() => expect(h.ui.selection.getSnapshot().status).toBe('ready'));
    expect(h.ui.commands.get(id).getState()).toMatchObject({ enabled: true, supported: true });
    expect(h.getCells).not.toHaveBeenCalled();
    expect(await h.ui.commands.executeAsync(id, payload)).toMatchObject({ success: true });
    const inputs = h.mutate.mock.calls.map(([input]) => readRecord(input));
    expect(inputs.map((input) => readRecord(input?.target)?.nodeId).sort()).toEqual(['A1', 'A2', 'C1', 'C2']);
    for (const input of inputs)
      expect(input).toMatchObject({ ...patch, target: { kind: 'block', nodeType: 'paragraph', story: body } });
    expect(h.find).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 1, within: expect.objectContaining({ nodeId: 'cell-a' }) }),
    );
  });

  it.each(['missing owner', 'failed page', 'malformed page', 'malformed target', 'wrong story', 'empty cell'])(
    'resolves the complete scope before writes: %s',
    async (failure) => {
      const h = mount();
      if (failure === 'missing owner') h.paragraphs.delete('cell-c');
      if (failure === 'empty cell') h.paragraphs.set('cell-c', []);
      const find = h.find.getMockImplementation();
      if (!find) throw new Error('Missing find implementation');
      h.find.mockImplementation(async (input) => {
        if (failure === 'failed page' && readRecord(input)?.offset === 1) throw new Error('read failed');
        if (readRecord(readRecord(input)?.within)?.nodeId === 'cell-c') {
          if (failure === 'malformed page') return { total: 2, offset: 0, limit: 1, items: [] };
          if (failure === 'malformed target' || failure === 'wrong story') {
            return {
              total: 1,
              offset: 0,
              limit: 1,
              items: [
                {
                  address: {
                    kind: 'block',
                    nodeType: failure === 'malformed target' ? 'tableCell' : 'paragraph',
                    nodeId: 'C1',
                    story:
                      failure === 'malformed target'
                        ? body
                        : { kind: 'story', storyType: 'headerFooterPart', refId: 'other-story' },
                  },
                },
              ],
            };
          }
        }
        return find(input);
      });
      expect(await h.ui.commands.executeAsync('text-align', 'center')).toBe(false);
      expect(h.mutate).not.toHaveBeenCalled();
    },
  );

  it.each([
    'selection',
    'table',
    'story',
    'editor',
    'document',
    'mode',
    'source',
    'lifetime',
    'mount',
    'request',
    'destroy',
  ])('rejects stale %s before the first write', async (change) => {
    const h = mount();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = h.find.getMockImplementation();
    if (!read) throw new Error('Missing find implementation');
    h.find.mockImplementation(async (input) => {
      await gate;
      return read(input);
    });
    const pending = h.ui.commands.executeAsync('text-align', 'center');
    await vi.waitFor(() => expect(h.find).toHaveBeenCalled());
    if (change === 'selection') h.select(cellSelection(['cell-b']));
    if (change === 'table') {
      const selected = cellSelection();
      if (!selected.tableSelection) throw new Error('Missing table selection');
      selected.tableSelection.tableId = 'other-table';
      h.select(selected);
    }
    if (change === 'story') {
      h.select(cellSelection(undefined, { kind: 'story', storyType: 'headerFooterPart', refId: 'other-story' }));
    }
    if (change === 'editor') h.superdoc.activeEditor = { editorVersion: 2 };
    if (change === 'document') Object.assign(h.superdoc.activeEditor, { doc: { ...h.doc } });
    if (change === 'mode') h.superdoc.config.documentMode = 'viewing';
    if (change === 'source') h.changeSource();
    if (change === 'lifetime') h.lifetime.abort();
    if (change === 'mount') h.remount();
    if (change === 'request') h.invalidateRequest();
    if (change === 'destroy') h.ui.destroy();
    release();
    expect(await pending).toBe(false);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it.each(commands)('disables $id without the public cell resolver', async ({ id, payload }) => {
    const h = mount();
    Object.assign(h.doc, { find: undefined });
    h.select(cellSelection());
    await vi.waitFor(() =>
      expect(h.ui.commands.get(id).getState()).toMatchObject({ enabled: false, reason: 'operation-unavailable' }),
    );
    expect(await h.ui.commands.executeAsync(id, payload)).toBe(false);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('awaits the existing mutation and paint settlement for all targets', async () => {
    const h = mount();
    let release = () => {};
    let paint = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const painted = new Promise<void>((resolve) => {
      paint = resolve;
    });
    const whenPainted = vi.fn(() => painted);
    Object.assign(h.superdoc.activeEditor, { documentMutationReadiness: { whenPainted } });
    h.mutate.mockImplementation(async () => {
      await gate;
      return { success: true };
    });
    let settled = false;
    const pending = h.ui.commands.executeAsync('text-align', 'right').then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(4));
    expect(settled).toBe(false);
    release();
    await vi.waitFor(() => expect(whenPainted).toHaveBeenCalled());
    expect(settled).toBe(false);
    paint();
    expect(await pending).toMatchObject({ success: true });
  });

  it('keeps the admitted targets when its own writes advance the source', async () => {
    const h = mount();
    h.mutate.mockImplementation(async () => {
      h.changeSource();
      return { success: true };
    });
    expect(await h.ui.commands.executeAsync('text-align', 'right')).toMatchObject({ success: true });
    expect(h.mutate).toHaveBeenCalledTimes(4);
  });

  it('bounds paragraph discovery for a complete 100-cell table', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `bulk-cell-${index}`);
    const h = mount(cellSelection(ids), 100);
    h.paragraphs.clear();
    for (const [index, id] of ids.entries()) {
      h.paragraphs.set(id, [
        { nodeId: `BULK-${index}`, nodeType: ['paragraph', 'heading', 'listItem'][index % 3] ?? 'paragraph' },
      ]);
    }
    expect(await h.ui.commands.executeAsync('text-align', 'center')).toMatchObject({ success: true });
    expect(h.find.mock.calls.length).toBeLessThanOrEqual(6);
    expect(h.mutate.mock.calls.map(([input]) => readRecord(readRecord(input)?.target)?.nodeId).sort()).toEqual(
      ids.map((_, index) => `BULK-${index}`).sort(),
    );
  });

  it('bounds concurrent partial-table reads and preserves unselected cells', async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `partial-cell-${index}`);
    const h = mount(cellSelection(ids.filter((_, index) => index % 2 === 0)), 100);
    h.paragraphs.clear();
    for (const [index, id] of ids.entries())
      h.paragraphs.set(id, [{ nodeId: `PARTIAL-${index}`, nodeType: 'paragraph' }]);
    const read = h.find.getMockImplementation();
    if (!read) throw new Error('Missing find implementation');
    let active = 0;
    let peak = 0;
    h.find.mockImplementation(async (input) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return read(input);
    });
    expect(await h.ui.commands.executeAsync('text-align', 'center')).toMatchObject({ success: true });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(h.mutate.mock.calls.map(([input]) => readRecord(readRecord(input)?.target)?.nodeId).sort()).toEqual(
      ids
        .filter((_, index) => index % 2 === 0)
        .map((_, index) => `PARTIAL-${index * 2}`)
        .sort(),
    );
  });

  it.each(['body owner', 'wrong cells', 'missing metadata', 'no table API'])(
    'retains exact header cell queries when bulk metadata has %s',
    async (failure) => {
      const story: StoryLocator = { kind: 'story', storyType: 'headerFooterPart', refId: 'fabricated-header' };
      const ids = Array.from({ length: 10 }, (_, index) => `header-cell-${index}`);
      const h = mount(cellSelection(ids, story), 100);
      h.paragraphs.clear();
      for (const [index, id] of ids.entries())
        h.paragraphs.set(id, [{ nodeId: `HEADER-${index}`, nodeType: 'paragraph' }]);
      const read = h.getCells.getMockImplementation();
      if (!read) throw new Error('Missing table implementation');
      h.getCells.mockImplementation(async () => {
        const result = await read();
        return {
          ...result,
          address: { ...result.address, story: failure === 'body owner' ? body : story },
          cells: result.cells.map((cell, index) => ({
            ...cell,
            nodeId: failure === 'wrong cells' && index === 0 ? 'UNSELECTED' : cell.nodeId,
            firstParagraphNodeId: failure === 'missing metadata' ? undefined : cell.firstParagraphNodeId,
          })),
        };
      });
      if (failure === 'no table API') Object.assign(h.doc, { tables: undefined });
      expect(await h.ui.commands.executeAsync('text-align', 'center')).toMatchObject({ success: true });
      expect(h.find).not.toHaveBeenCalledWith(
        expect.objectContaining({ within: expect.objectContaining({ nodeType: 'table' }) }),
      );
      expect(h.mutate).toHaveBeenCalledTimes(10);
      for (const [input] of h.mutate.mock.calls) expect(input).toMatchObject({ target: { story } });
    },
  );

  it.each(['bad page', 'wrong story', 'missing first paragraph', 'query failure'])(
    'refuses all writes when whole-table discovery has %s',
    async (failure) => {
      const ids = Array.from({ length: 105 }, (_, index) => `paged-cell-${index}`);
      const h = mount(cellSelection(ids), 100);
      h.paragraphs.clear();
      for (const [index, id] of ids.entries())
        h.paragraphs.set(id, [{ nodeId: `PAGED-${index}`, nodeType: 'paragraph' }]);
      const read = h.find.getMockImplementation();
      if (!read) throw new Error('Missing find implementation');
      h.find.mockImplementation(async (input) => {
        const result = readRecord(await read(input));
        if (readRecord(input)?.offset !== 100) return result;
        if (failure === 'query failure') throw new Error('Table query unavailable');
        if (failure === 'bad page') return { ...result, offset: 0 };
        const items = Array.isArray(result?.items) ? result.items : [];
        return {
          ...result,
          items: items.map((item) => ({
            ...readRecord(item),
            address: {
              ...readRecord(readRecord(item)?.address),
              ...(failure === 'wrong story'
                ? { story: { kind: 'story', storyType: 'headerFooterPart', refId: 'other' } }
                : { nodeId: 'UNOWNED' }),
            },
          })),
        };
      });
      expect(await h.ui.commands.executeAsync('text-align', 'center')).toBe(false);
      expect(h.mutate).not.toHaveBeenCalled();
      for (const [input] of h.find.mock.calls) expect(input).toMatchObject({ within: { nodeType: 'table' } });
    },
  );

  it('rejects a selection change while whole-table metadata is pending', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `stale-cell-${index}`);
    const h = mount(cellSelection(ids), 100);
    h.paragraphs.clear();
    for (const [index, id] of ids.entries())
      h.paragraphs.set(id, [{ nodeId: `STALE-${index}`, nodeType: 'paragraph' }]);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = h.getCells.getMockImplementation();
    if (!read) throw new Error('Missing table implementation');
    h.getCells.mockImplementation(async () => {
      await gate;
      return read();
    });
    const pending = h.ui.commands.executeAsync('text-align', 'center');
    await vi.waitFor(() => expect(h.getCells).toHaveBeenCalled());
    h.select(cellSelection(['other']));
    release();
    expect(await pending).toBe(false);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it.each(['membership', 'indentation', 'source'])(
    'rejects an incomplete or stale hybrid %s plan before writing',
    async (failure) => {
      const h = mount();
      h.getState.mockImplementation(async () => {
        if (failure === 'membership') throw new Error('membership failed');
        if (failure === 'source') h.changeSource();
        return { success: true, isListItem: false };
      });
      if (failure === 'indentation') {
        const find = h.find.getMockImplementation();
        h.find.mockImplementation(async (input) => {
          if (readRecord(readRecord(input)?.options)?.includeResolved) throw new Error('resolved read failed');
          return find?.(input);
        });
      }
      expect(await h.ui.commands.executeAsync('indent-increase')).toBe(false);
      expect(h.mutate).not.toHaveBeenCalled();
      expect(h.indentRange).not.toHaveBeenCalled();
      expect(h.getNode).not.toHaveBeenCalled();
    },
  );

  it.each([
    { axis: 'horizontal', command: 'indent-increase', level: 0, next: 1 },
    { axis: 'vertical', command: 'indent-increase', level: 0, next: 1 },
    { axis: 'horizontal', command: 'indent-decrease', level: 1, next: 0 },
    { axis: 'vertical', command: 'indent-decrease', level: 1, next: 0 },
  ])('changes exact $axis list-cell levels for $command', async ({ axis, command, level, next }) => {
    const selected = axis === 'horizontal' ? ['A1', 'B1'] : ['A1', 'C1'];
    const selection = cellSelection(selected.map((id) => `cell-${id}`));
    if (!selection.tableSelection) throw new Error('Missing table selection');
    selection.tableSelection.isRectangular = true;
    selection.tableSelection.end = {
      rowIndex: axis === 'vertical' ? 1 : 0,
      columnIndex: axis === 'horizontal' ? 1 : 0,
    };
    selection.tableSelection.cells = selected.map((id, index) => ({
      nodeId: `cell-${id}`,
      rowIndex: axis === 'vertical' ? index : 0,
      columnIndex: axis === 'horizontal' ? index : 0,
      rowspan: 1,
      colspan: 1,
    }));
    const h = mount(selection);
    const order = ['A1', 'B1', 'C1', 'D1'];
    const levels = new Map(order.map((id) => [id, level]));
    h.paragraphs.clear();
    for (const nodeId of order) h.paragraphs.set(`cell-${nodeId}`, [{ nodeId, nodeType: 'listItem' }]);
    h.getState.mockResolvedValue({ success: true, isListItem: true });
    const changeLevel = async (raw: unknown, direction: number) => {
      const paraIds = readRecord(raw)?.paraIds;
      if (!Array.isArray(paraIds) || !paraIds.every((id): id is string => typeof id === 'string')) {
        throw new Error('Missing paragraph IDs');
      }
      const first = order.indexOf(paraIds[0] ?? '');
      if (first < 0 || paraIds.some((id, index) => order[first + index] !== id)) {
        return {
          success: false,
          failure: {
            code: 'INVALID_TARGET',
            message: 'The list range must contain contiguous paragraphs in document order.',
          },
        };
      }
      for (const id of paraIds) {
        const current = levels.get(id);
        if (current === undefined) throw new Error('Missing list paragraph');
        levels.set(id, Math.max(0, Math.min(8, current + direction)));
      }
      return { success: true };
    };
    Object.assign(h.doc.lists, {
      indentRange: (input: unknown) => changeLevel(input, 1),
      outdentRange: (input: unknown) => changeLevel(input, -1),
    });
    expect(h.ui.commands.get(command).getState()).toMatchObject({ enabled: true });
    expect(await h.ui.commands.executeAsync(command)).toMatchObject({ success: true });
    expect([...levels]).toEqual(order.map((id) => [id, selected.includes(id) ? next : level]));
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it.each(['indent-increase', 'indent-decrease'])('retains one contiguous text-list range for %s', async (command) => {
    const h = mount({
      ...cellSelection(),
      target: {
        kind: 'text',
        segments: [
          { blockId: 'A1', range: { start: 0, end: 2 } },
          { blockId: 'A2', range: { start: 0, end: 2 } },
        ],
      },
      tableSelection: undefined,
    });
    h.getState.mockResolvedValue({ success: true, isListItem: true });
    expect(await h.ui.commands.executeAsync(command)).toMatchObject({ success: true });
    expect(h.indentRange).toHaveBeenCalledExactlyOnceWith({ paraIds: ['A1', 'A2'], story: body });
    expect(h.find).not.toHaveBeenCalled();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('preserves first-item range semantics for a single selected body list paragraph', async () => {
    const h = mount(cellSelection(['cell-a']));
    h.paragraphs.set('cell-a', [{ nodeId: 'A1', nodeType: 'listItem' }]);
    h.getState.mockResolvedValue({ success: true, isListItem: true });
    h.superdoc.config.documentMode = 'suggesting';
    expect(await h.ui.commands.executeAsync('indent-increase')).toMatchObject({ success: true });
    expect(h.indentRange).toHaveBeenCalledExactlyOnceWith(
      { paraIds: ['A1'], story: body, preserveFirstItemLevel: true },
      { changeMode: 'tracked' },
    );
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it.each(['indent-increase', 'indent-decrease'])(
    'retains tracked per-item routing for multiple list cells: %s',
    async (command) => {
      const h = mount();
      h.getState.mockResolvedValue({ success: true, isListItem: true });
      h.superdoc.config.documentMode = 'suggesting';
      expect(await h.ui.commands.executeAsync(command)).toMatchObject({ success: true });
      expect(h.indentRange).not.toHaveBeenCalled();
      expect(h.mutate).toHaveBeenCalledTimes(4);
      for (const nodeId of ['A1', 'A2', 'C1', 'C2']) {
        expect(h.mutate).toHaveBeenCalledWith(
          { target: { kind: 'block', nodeType: 'listItem', nodeId } },
          { changeMode: 'tracked' },
        );
      }
    },
  );

  it('propagates a native range failure without retrying per-item mutations', async () => {
    const h = mount();
    const failure = { success: false, failure: { code: 'PERMISSION_DENIED', message: 'Protected list paragraph' } };
    h.getState.mockResolvedValue({ success: true, isListItem: true });
    h.indentRange.mockResolvedValue(failure);
    expect(await h.ui.commands.executeAsync('indent-increase')).toEqual(failure);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('plans each mixed paragraph and list indentation independently', async () => {
    const h = mount();
    h.getState.mockImplementation(async (input) => ({
      success: true,
      isListItem: readRecord(readRecord(input)?.target)?.nodeId === 'C2',
    }));
    h.directIndents.set('A1', { start: 72 });
    expect(await h.ui.commands.executeAsync('indent-increase')).toMatchObject({ success: true });
    expect(h.mutate).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'A1', story: body },
      left: 2160,
    });
    expect(h.mutate).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'A2', story: body },
      left: 1440,
    });
    expect(h.mutate).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'C1', story: body },
      left: 1440,
    });
    expect(h.find).toHaveBeenCalledWith({
      select: { type: 'node', nodeType: 'heading' },
      within: { kind: 'block', nodeType: 'heading', nodeId: 'C1', story: body },
      in: body,
      options: { includeResolved: true },
      limit: 2,
      offset: 0,
    });
    expect(h.mutate).toHaveBeenCalledWith({ target: { kind: 'block', nodeType: 'listItem', nodeId: 'C2' } });
    expect(h.indentRange).not.toHaveBeenCalled();
  });

  it('does not write an indent when decreasing a paragraph already at zero', async () => {
    const h = mount(cellSelection(['cell-a']));
    h.absentIndents.add('A1');
    h.directIndents.set('A2', { left: 36 });
    expect(await h.ui.commands.executeAsync('indent-decrease')).toMatchObject({ success: true });
    expect(h.mutate).not.toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ nodeId: 'A1' }) }),
    );
    expect(h.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ nodeId: 'A2' }), left: 0 }),
    );
  });

  it('reports success without a mutation when every selected paragraph is at zero', async () => {
    const h = mount(cellSelection(['cell-a']));
    h.directIndents.set('A1', { left: 0 });
    h.directIndents.set('A2', { left: 0 });
    expect(await h.ui.commands.executeAsync('indent-decrease')).toBe(true);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  describe.each(['fabricated-header', 'fabricated-footer'])('indentation in %s cells', (refId) => {
    it.each(['indent-increase', 'indent-decrease'])(
      'applies %s to mixed paragraphs in their exact story',
      async (id) => {
        const story: StoryLocator = { kind: 'story', storyType: 'headerFooterPart', refId };
        const h = mount(cellSelection(['cell-a', 'cell-c'], story));
        Object.assign(h.doc, { getNode: undefined });
        const range = vi.fn(async () => ({ success: true }));
        Object.assign(h.doc.lists, { [id === 'indent-increase' ? 'indentRange' : 'outdentRange']: range });
        h.getState.mockImplementation(async (input) => ({
          success: true,
          isListItem: readRecord(readRecord(input)?.target)?.nodeId === 'C2',
        }));
        await vi.waitFor(() =>
          expect(h.ui.commands.get(id).getState()).toMatchObject({ enabled: true, supported: true }),
        );
        expect(await h.ui.commands.executeAsync(id)).toMatchObject({ success: true });
        expect(range).toHaveBeenCalledExactlyOnceWith({ paraIds: ['C2'], story });
        expect(h.indentRange).not.toHaveBeenCalled();
        expect(h.mutate).toHaveBeenCalledTimes(3);
        expect(h.mutate.mock.calls.map(([input]) => readRecord(readRecord(input)?.target)?.nodeId)).toEqual([
          'A1',
          'A2',
          'C1',
        ]);
        for (const [input] of h.mutate.mock.calls) expect(input).toMatchObject({ target: { story } });
      },
    );

    it.each(['indent-increase', 'indent-decrease'])('disables unavailable suggesting-mode list %s', async (id) => {
      const story: StoryLocator = { kind: 'story', storyType: 'headerFooterPart', refId };
      const h = mount(cellSelection(['cell-c'], story));
      h.paragraphs.set('cell-c', [{ nodeId: 'C2', nodeType: 'listItem' }]);
      h.getState.mockResolvedValue({ success: true, isListItem: true });
      h.superdoc.config.documentMode = 'suggesting';
      h.ui.commands.get(id).getState();
      await vi.waitFor(() => expect(h.getState).toHaveBeenCalled());
      await vi.waitFor(() =>
        expect(h.ui.commands.get(id).getState()).toMatchObject({ enabled: false, supported: false }),
      );
      expect(await h.ui.commands.executeAsync(id)).toBe(false);
      expect(h.mutate).not.toHaveBeenCalled();
      expect(h.indentRange).not.toHaveBeenCalled();
    });

    it('retains the supported story outdent route in suggesting mode', async () => {
      const story: StoryLocator = { kind: 'story', storyType: 'headerFooterPart', refId };
      const h = mount(cellSelection(['cell-c'], story));
      h.paragraphs.set('cell-c', [{ nodeId: 'C2', nodeType: 'listItem' }]);
      h.getState.mockResolvedValue({ success: true, isListItem: true });
      h.superdoc.config.documentMode = 'suggesting';
      const outdentInStory = vi.fn(async () => ({ success: true }));
      Object.assign(h.doc.lists, { outdentInStory });
      await vi.waitFor(() => expect(h.ui.commands.get('indent-decrease').getState()).toMatchObject({ enabled: true }));
      expect(await h.ui.commands.executeAsync('indent-decrease')).toMatchObject({ success: true });
      expect(outdentInStory).toHaveBeenCalledExactlyOnceWith(
        { target: { kind: 'block', nodeType: 'listItem', nodeId: 'C2' }, story },
        { changeMode: 'tracked' },
      );
      expect(h.mutate).not.toHaveBeenCalled();
      expect(h.indentRange).not.toHaveBeenCalled();
    });

    it('keeps plain paragraph indentation available in suggesting mode', async () => {
      const story: StoryLocator = { kind: 'story', storyType: 'headerFooterPart', refId };
      const h = mount(cellSelection(['cell-a'], story));
      h.superdoc.config.documentMode = 'suggesting';
      await vi.waitFor(() => expect(h.ui.commands.get('indent-increase').getState()).toMatchObject({ enabled: true }));
      expect(await h.ui.commands.executeAsync('indent-increase')).toMatchObject({ success: true });
      expect(h.mutate).toHaveBeenCalledTimes(2);
      for (const [input, options] of h.mutate.mock.calls) {
        expect(input).toMatchObject({ target: { story } });
        expect(options).toEqual({ changeMode: 'tracked' });
      }
      expect(h.indentRange).not.toHaveBeenCalled();
    });
  });

  it('preserves the registered first-party route and tracked options after async discovery', async () => {
    const h = mount();
    h.superdoc.config.documentMode = 'suggesting';
    const routed = vi.fn(async (_path: string, _args: readonly unknown[]) => ({ success: true }));
    registerFirstPartyCommandMutation(h.superdoc, h.host, {
      supports: (path) => path === 'format.paragraph.setAlignment',
      run: routed,
      runListApply: async () => false,
    });
    expect(await executeFirstPartyCommandAsync(h.ui, 'text-align', 'center')).toMatchObject({ success: true });
    expect(routed).toHaveBeenCalledTimes(4);
    expect(routed).toHaveBeenCalledWith('format.paragraph.setAlignment', [
      expect.anything(),
      { changeMode: 'tracked' },
    ]);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('carries non-body targets with a qualified table ID and no table read API', async () => {
    const story: StoryLocator = { kind: 'story', storyType: 'headerFooterPart', refId: 'fabricated-header' };
    const selected = cellSelection(undefined, story);
    if (!selected.tableSelection) throw new Error('Missing table selection');
    selected.tableSelection.tableId = 'header:/word/header1.xml#tbl:D0000001';
    const h = mount(selected);
    Object.assign(h.doc, { tables: undefined });
    expect(await h.ui.commands.executeAsync('text-align', 'right')).toMatchObject({ success: true });
    expect(h.getCells).not.toHaveBeenCalled();
    expect(h.find).toHaveBeenCalledWith(
      expect.objectContaining({ in: story, within: expect.objectContaining({ story }) }),
    );
    for (const [input] of h.mutate.mock.calls) expect(input).toMatchObject({ target: { story } });
  });

  it('rejects a missing header owner without retrying another story or writing a prefix', async () => {
    const story: StoryLocator = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId100' };
    const h = mount(cellSelection(undefined, story));
    h.paragraphs.delete('cell-c');
    expect(await h.ui.commands.executeAsync('text-align', 'right')).toBe(false);
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.getCells).not.toHaveBeenCalled();
    expect(h.find).toHaveBeenCalledWith(
      expect.objectContaining({ in: story, within: expect.objectContaining({ nodeId: 'cell-c', story }) }),
    );
    for (const [input] of h.find.mock.calls) {
      expect(input).toMatchObject({ in: story, within: { story } });
    }
  });

  describe.each([false, true])('header table with a body table ID collision: %s', (collision) => {
    it.each(commands)('applies $id only to the selected header paragraphs', async ({ id, payload, patch }) => {
      const story: StoryLocator = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId100' };
      const firstParagraphId = collision ? 'C0000001' : 'D0000001';
      const cellIds = [`tc:${firstParagraphId}`, 'tc:A0000002'];
      const selected = cellSelection(cellIds, story);
      if (!selected.tableSelection) throw new Error('Missing table selection');
      selected.tableSelection.tableId = 'tbl:D0000001';
      const h = mount(selected);
      h.paragraphs.clear();
      h.paragraphs.set(`tc:${firstParagraphId}`, [{ nodeId: firstParagraphId, nodeType: 'paragraph' }]);
      h.paragraphs.set('tc:A0000002', [{ nodeId: 'A0000002', nodeType: 'paragraph' }]);
      h.getCells.mockResolvedValue({
        nodeId: 'tbl:D0000001',
        address: { kind: 'block', nodeType: 'table', nodeId: 'tbl:D0000001', story: undefined },
        cells: ['tc:D0000001', collision ? 'tc:B0000002' : 'tc:A0000002'].map((nodeId) => ({
          nodeId,
          address: { kind: 'block', nodeType: 'tableCell', nodeId, story: undefined },
          firstParagraphNodeId: nodeId.slice(3),
        })),
      });
      await vi.waitFor(() =>
        expect(h.ui.commands.get(id).getState()).toMatchObject({ enabled: true, supported: true }),
      );
      expect(await h.ui.commands.executeAsync(id, payload)).toMatchObject({ success: true });
      expect(h.getCells).not.toHaveBeenCalled();
      expect(h.mutate).toHaveBeenCalledTimes(2);
      for (const nodeId of [firstParagraphId, 'A0000002']) {
        expect(h.mutate).toHaveBeenCalledWith({
          ...patch,
          target: { kind: 'block', nodeType: 'paragraph', nodeId, story },
        });
      }
      for (const cellId of cellIds) {
        expect(h.find).toHaveBeenCalledWith(
          expect.objectContaining({
            in: story,
            within: { kind: 'block', nodeType: 'tableCell', nodeId: cellId, story },
          }),
        );
      }
    });
  });

  it.each(commands)('preserves ordinary text routing for $id', async ({ id, payload }) => {
    const selected = cellSelection();
    const h = mount({
      ...selected,
      target: { kind: 'text', segments: [{ blockId: 'TEXT', range: { start: 0, end: 2 } }] },
      tableSelection: selected.tableSelection ? { ...selected.tableSelection, selectionMode: 'text' } : undefined,
    });
    expect(await h.ui.commands.executeAsync(id, payload)).toMatchObject({ success: true });
    expect(h.getCells).not.toHaveBeenCalled();
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ nodeId: 'TEXT' }) }),
    );
  });
});
