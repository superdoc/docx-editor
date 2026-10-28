import { describe, expect, it, vi } from 'vite-plus/test';
import {
  createSuperDocUI,
  executeFirstPartyCommandAsync,
  registerFirstPartyCommandMutation,
} from './create-super-doc-ui.js';
import { SUPERDOC_UI_REASONS } from './reasons.js';

const target = {
  kind: 'selection',
  story: { kind: 'story', storyType: 'body' },
  start: { kind: 'text', blockId: 'first-cell', offset: 0 },
  end: { kind: 'text', blockId: 'last-cell', offset: 5 },
};
const empty = {
  empty: true,
  target: null,
  selectionTarget: null,
  activeMarks: [],
  activeCommentIds: [],
  activeChangeIds: [],
};
const table = { ...empty, empty: false, selectionTarget: target };

function heldTableFormatting(
  contract: 'text' | 'object' | 'legacy-object' = 'text',
  initiallySelected = false,
  priorRange = false,
  actualTableAtCapture?: 'missing' | 'foreign',
) {
  const story = target.story;
  const segments = ['first-cell', 'middle-cell', 'last-cell'].map((blockId) => ({
    blockId,
    range: { start: 0, end: 5 },
  }));
  const selected = {
    ...table,
    selectionTarget:
      contract === 'object'
        ? null
        : contract === 'legacy-object'
          ? { ...target, end: { ...target.end, offset: 6 } }
          : target,
    target: { kind: 'text', story, segments },
    tableSelection: {
      kind: 'tableCells',
      type: 'table',
      selectionMode: 'cells',
      isRectangular: true,
      tableId: 'table',
      story,
      start: { rowIndex: 0, columnIndex: 0 },
      end: { rowIndex: 0, columnIndex: 2 },
      cells: segments.map(({ blockId }, columnIndex) => ({
        nodeId: blockId,
        rowIndex: 0,
        columnIndex,
        rowspan: 1,
        colspan: 1,
      })),
    },
  };
  let nodeId: string | null = initiallySelected ? 'table' : null;
  let listener: ((nodeId: string | null) => void) | null = null;
  let hostSelection: object | null = {
    revision: 1,
    anchor: { blockId: 'first-cell', blockOffset: 0 },
    focus: { blockId: 'last-cell', blockOffset: 5 },
    story,
  };
  const tableHostSelection =
    contract === 'text'
      ? hostSelection
      : {
          ...hostSelection,
          focus: { blockId: 'last-cell', blockOffset: 6 },
        };
  if (contract !== 'text')
    hostSelection = {
      revision: 0,
      anchor: { blockId: 'first-cell', blockOffset: 0 },
      focus: { blockId: 'first-cell', blockOffset: 0 },
      story,
    };
  if (priorRange)
    hostSelection = {
      revision: 0,
      anchor: { blockId: 'first-cell', blockOffset: 1 },
      focus: { blockId: 'last-cell', blockOffset: 2 },
      story,
    };
  if (initiallySelected) hostSelection = tableHostSelection;
  let mounted = {};
  let lifetime = new AbortController();
  let applied: unknown = selected;
  let foreground = { active: 0, pending: 0 };
  const reads: Array<(value: unknown) => void> = [];
  const events = new Map<string, (...args: unknown[]) => void>();
  let hostEvent: ((event: unknown) => void) | null = null;
  const alignments = new Map<string, string>();
  const setAlignment = vi.fn((input: { target: { nodeId: string }; alignment: string }) => {
    alignments.set(input.target.nodeId, input.alignment);
    return { success: true };
  });
  let selectionListener: ((snapshot: object) => void) | null = null;
  let selectionSource = {
    getSnapshot: () => hostSelection,
    subscribe: (next: typeof selectionListener) => {
      selectionListener = next;
      return () => {};
    },
  };
  let initialTableRead = initiallySelected;
  const actualTableReads: Array<string | null> = [];
  const tableSource = {
    getWholeTableNodeId: () => {
      const value = initialTableRead
        ? nodeId
        : actualTableAtCapture === 'missing'
          ? null
          : actualTableAtCapture === 'foreign'
            ? 'other-table'
            : nodeId;
      initialTableRead = false;
      actualTableReads.push(value);
      return value;
    },
    subscribeWholeTable: (next: typeof listener) => {
      listener = next;
      return () => {};
    },
  };
  const host = {
    getHandles: () => ({ editing: { selection: selectionSource }, selection: tableSource }),
    readLiveSelectionSyncSnapshot: () => (nodeId ? selected : empty),
    readAppliedSelectionPresentation: () => (applied ? { selection: applied } : null),
    getForegroundMutationState: () => foreground,
    getForegroundInteractionLifetime: () => lifetime.signal,
    getMountedHandle: () => mounted,
    getSnapshot: () => ({ state: 'editing-ready', documentMode: 'editing' }),
    events: {
      subscribe: (next: typeof hostEvent) => {
        hostEvent = next;
        return () => {};
      },
    },
  };
  const doc = {
    selection: { current: () => new Promise((resolve) => reads.push(resolve)) },
    format: { paragraph: { setAlignment } },
  };
  const superdoc = {
    activeEditor: { id: 'editor', editorVersion: 2, host, doc },
    config: { documentMode: 'editing' },
    on: (event: string, next: (...args: unknown[]) => void) => events.set(event, next),
    off: () => {},
  };
  registerFirstPartyCommandMutation(superdoc, host, {
    supports: (path) => path === 'format.paragraph.setAlignment',
    run: (_path, args) => setAlignment(args[0] as Parameters<typeof setAlignment>[0]),
    runListApply: async () => false,
  });
  const ui = createSuperDocUI({ superdoc } as never);
  const select = () => {
    nodeId = 'table';
    listener!('table');
    hostSelection = tableHostSelection;
  };
  return {
    ui,
    select,
    setAlignment,
    alignments,
    selected,
    actualTableReads,
    rebindToSettledTable: () => {
      nodeId = 'table';
      hostSelection = tableHostSelection;
      selectionSource = { ...selectionSource };
      superdoc.activeEditor = { ...superdoc.activeEditor };
      events.get('active-editor-change')?.();
    },
    publishRange: () => {
      if (hostSelection) selectionListener?.(hostSelection);
    },
    clear: () => {
      nodeId = null;
      listener!(null);
    },
    changeSelection: () => {
      hostSelection = {
        revision: 2,
        anchor: { blockId: 'first-cell', blockOffset: 0 },
        focus: { blockId: 'first-cell', blockOffset: 0 },
        story,
      };
    },
    changeRawIdentity: () => {
      hostSelection = { ...hostSelection };
    },
    loseNative: () => {
      hostSelection = null;
    },
    wrongNativeBlock: () => {
      hostSelection = { ...tableHostSelection, focus: { blockId: 'other-cell', blockOffset: 6 } };
      selectionListener?.(hostSelection);
    },
    wrongStory: () => {
      hostSelection = {
        ...tableHostSelection,
        story: { kind: 'story', storyType: 'headerFooterPart', refId: 'header' },
      };
      selectionListener?.(hostSelection);
    },
    retire: () => {
      lifetime.abort();
      lifetime = new AbortController();
    },
    remount: () => {
      mounted = {};
    },
    sourceChange: () => {
      applied = null;
      events.get('document-replaced')?.({ host });
    },
    mutateSource: () => {
      applied = null;
      hostEvent?.({ type: 'document:mutated' });
    },
    applyCurrentSource: () => {
      applied = selected;
      hostSelection = { ...tableHostSelection, revision: 2 };
      selectionListener?.(hostSelection);
    },
    changeDocument: () => {
      superdoc.activeEditor.doc = { ...doc };
    },
    changeTable: () => {
      nodeId = 'other-table';
    },
    unpaint: () => {
      applied = null;
    },
    changeAppliedTarget: () => {
      applied = { ...selected, target: { ...selected.target, segments: segments.slice(1) } };
    },
    changeAppliedCells: () => {
      applied = {
        ...selected,
        tableSelection: { ...selected.tableSelection, cells: selected.tableSelection.cells.slice(1) },
      };
    },
    queueInput: () => {
      foreground = { active: 1, pending: 1 };
    },
    destroy: () => {
      ui.destroy();
      for (const resolve of reads) resolve(empty);
    },
  };
}

describe('whole-table host selection subscription', () => {
  it.each([
    ['initial attachment', 'missing', true],
    ['initial attachment', 'foreign', true],
    ['native publication', 'missing', false],
    ['native publication', 'foreign', false],
  ] as const)(
    'refuses a captured object table from %s when the actual table identity is %s (initially selected: %s)',
    async (_route, actualTableAtCapture, initiallySelected) => {
      const h = heldTableFormatting('object', initiallySelected, false, actualTableAtCapture);
      try {
        if (!initiallySelected) {
          h.select();
          h.publishRange();
        }
        expect(h.ui.selection.getSnapshot().tableSelection?.tableId).toBe('table');
        expect(h.ui.selection.getSnapshot().selectionTarget).toBeNull();
        const readsBeforeDispatch = h.actualTableReads.length;
        void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
        for (let i = 0; i < 8; i++) await Promise.resolve();
        expect(h.actualTableReads.slice(readsBeforeDispatch)).toContain(
          actualTableAtCapture === 'missing' ? null : 'other-table',
        );
        expect(h.setAlignment).not.toHaveBeenCalled();
        expect(h.alignments.size).toBe(0);
      } finally {
        h.destroy();
      }
    },
  );

  it('reacquires the same object table after its source mutation and current native presentation', async () => {
    const h = heldTableFormatting('object');
    try {
      h.select();
      h.publishRange();
      void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
      await vi.waitFor(() => expect(h.setAlignment).toHaveBeenCalledTimes(3));
      h.mutateSource();
      h.applyCurrentSource();
      void executeFirstPartyCommandAsync(h.ui, 'text-align', 'right').catch(() => {});
      await vi.waitFor(() => expect(h.setAlignment).toHaveBeenCalledTimes(6));
      expect([...h.alignments]).toEqual(['first-cell', 'middle-cell', 'last-cell'].map((id) => [id, 'right']));
    } finally {
      h.destroy();
    }
  });

  it('does not reacquire an object table from a native event before the new source has applied', async () => {
    const h = heldTableFormatting('object');
    try {
      h.select();
      h.publishRange();
      h.mutateSource();
      h.publishRange();
      void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(h.setAlignment).not.toHaveBeenCalled();
    } finally {
      h.destroy();
    }
  });

  it.each(['text', 'legacy-object', 'object'] as const)(
    'attaches to an already applied %s table without requiring another native publication',
    async (contract) => {
      const h = heldTableFormatting(contract, true);
      try {
        void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
        await vi.waitFor(() => expect(h.setAlignment).toHaveBeenCalledTimes(3));
      } finally {
        h.destroy();
      }
    },
  );

  it.each(['text', 'object'] as const)('rebinds to an already applied %s table', async (contract) => {
    const h = heldTableFormatting(contract);
    try {
      h.rebindToSettledTable();
      void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
      await vi.waitFor(() => expect(h.setAlignment).toHaveBeenCalledTimes(3));
    } finally {
      h.destroy();
    }
  });

  it('does not bind a prior noncollapsed range beside a new table notification', async () => {
    const h = heldTableFormatting('object', false, true);
    try {
      h.select();
      h.publishRange();
      void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
      await vi.waitFor(() => expect(h.setAlignment).toHaveBeenCalledTimes(3));
    } finally {
      h.destroy();
    }
  });

  it.each(['legacy-object', 'object'] as const)(
    'aligns every object-bearing table paragraph with the %s public contract while the read is held',
    async (contract) => {
      const h = heldTableFormatting(contract);
      try {
        h.select();
        h.publishRange();
        expect(h.ui.selection.getSnapshot().selectionTarget).toEqual(h.selected.selectionTarget);
        expect(h.ui.selection.getSnapshot().target?.segments).toHaveLength(3);
        void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
        await vi.waitFor(() => expect(h.setAlignment).toHaveBeenCalledTimes(3));
        expect([...h.alignments]).toEqual(['first-cell', 'middle-cell', 'last-cell'].map((id) => [id, 'center']));
      } finally {
        h.destroy();
      }
    },
  );

  it.each([
    'clear',
    'changeSelection',
    'retire',
    'remount',
    'sourceChange',
    'mutateSource',
    'changeDocument',
    'changeTable',
    'unpaint',
    'changeAppliedTarget',
    'changeAppliedCells',
    'queueInput',
    'changeRawIdentity',
    'loseNative',
    'wrongNativeBlock',
    'wrongStory',
  ] as const)('does not reuse an object-bearing table paragraph seed after %s', async (change) => {
    const h = heldTableFormatting('object');
    try {
      h.select();
      h.publishRange();
      h[change]();
      void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(h.setAlignment).not.toHaveBeenCalled();
    } finally {
      h.destroy();
    }
  });

  it.each(['unpublished', 'wrongNativeBlock', 'wrongStory', 'sourceChange'] as const)(
    'does not bind an object-bearing seed to a mismatched native publication (%s)',
    async (change) => {
      const h = heldTableFormatting('object');
      try {
        h.select();
        if (change !== 'unpublished') h[change]();
        if (change === 'sourceChange') h.publishRange();
        void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
        for (let i = 0; i < 8; i++) await Promise.resolve();
        expect(h.setAlignment).not.toHaveBeenCalled();
      } finally {
        h.destroy();
      }
    },
  );

  it('aligns every current table paragraph after a range publication makes its held read stale', async () => {
    const h = heldTableFormatting();
    try {
      h.select();
      h.publishRange();
      expect(h.ui.selection.getSnapshot().status).toBe('stale');
      expect(h.ui.selection.getSnapshot().target?.segments).toHaveLength(3);
      void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
      await vi.waitFor(() => expect(h.setAlignment).toHaveBeenCalledTimes(3));
      expect([...h.alignments]).toEqual(['first-cell', 'middle-cell', 'last-cell'].map((id) => [id, 'center']));
    } finally {
      h.destroy();
    }
  });

  it.each([
    'clear',
    'changeSelection',
    'retire',
    'remount',
    'sourceChange',
    'mutateSource',
    'changeDocument',
    'changeTable',
    'unpaint',
    'changeAppliedTarget',
    'changeAppliedCells',
    'queueInput',
  ] as const)('does not reuse a stale table paragraph seed after %s', async (change) => {
    const h = heldTableFormatting();
    try {
      h.select();
      h.publishRange();
      h[change]();
      void executeFirstPartyCommandAsync(h.ui, 'text-align', 'center').catch(() => {});
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(h.setAlignment).not.toHaveBeenCalled();
    } finally {
      h.destroy();
    }
  });

  it('seeds and clears the formatting target before held worker reads settle', async () => {
    let nodeId: string | null = null;
    let listener: ((nodeId: string | null) => void) | null = null;
    const detach = vi.fn(() => {
      listener = null;
    });
    const pending: Array<(info: unknown) => void> = [];
    const selectionSource = { subscribe: () => () => {} };
    const host = {
      getHandles: () => ({
        editing: { selection: selectionSource },
        selection: {
          getWholeTableNodeId: () => nodeId,
          subscribeWholeTable: (next: typeof listener) => {
            listener = next;
            return detach;
          },
        },
      }),
      readLiveSelectionSyncSnapshot: () => (nodeId ? table : empty),
    };
    const superdoc = {
      activeEditor: {
        id: 'editor',
        editorVersion: 2,
        host,
        doc: { selection: { current: () => new Promise((resolve) => pending.push(resolve)) } },
      },
      on: () => {},
      off: () => {},
    };
    const ui = createSuperDocUI({ superdoc } as never);
    nodeId = 'table';
    listener!('table');
    expect(ui.selection.getSnapshot()).toMatchObject({ empty: false, selectionTarget: target });
    const selectedTableRead = pending.at(-1);
    nodeId = null;
    listener!(null);
    expect(ui.selection.getSnapshot()).toMatchObject({ empty: true, selectionTarget: null });
    // A delayed read for the old selection must not re-enable table formatting.
    selectedTableRead?.(table);
    await Promise.resolve();
    expect(ui.selection.getSnapshot()).toMatchObject({ empty: true, selectionTarget: null });
    ui.destroy();
    expect(detach).toHaveBeenCalledOnce();
  });
});

describe('restoring a captured cell selection', () => {
  const mountRestoreHost = () => {
    const apply = vi.fn(() => ({ ok: true }));
    const host = { getHandles: () => ({ editing: { selectionTargets: { apply } } }) };
    const ui = createSuperDocUI({
      superdoc: { activeEditor: { editorVersion: 2, host, doc: {} } },
    } as never);
    return { ui, apply };
  };

  it('re-applies a well-formed captured cell target as a cell selection', () => {
    const { ui, apply } = mountRestoreHost();
    try {
      expect(ui.selection.restore({ _tableCellSelectionTarget: target } as never)).toMatchObject({
        ok: true,
        success: true,
      });
      expect(apply).toHaveBeenCalledWith(expect.objectContaining({ kind: 'selection' }), { tableCells: true });
    } finally {
      ui.destroy();
    }
  });

  it.each([
    { label: 'a non-object point', start: 'first-cell' },
    { label: 'a string offset', start: { kind: 'text', blockId: 'first-cell', offset: '0' } },
    { label: 'a negative offset', start: { kind: 'text', blockId: 'first-cell', offset: -1 } },
    { label: 'a fractional offset', start: { kind: 'text', blockId: 'first-cell', offset: 1.5 } },
    { label: 'an empty blockId', start: { kind: 'text', blockId: '', offset: 0 } },
  ])('rejects $label without throwing and without reaching the host', ({ start }) => {
    const { ui, apply } = mountRestoreHost();
    try {
      expect(ui.selection.restore({ _tableCellSelectionTarget: { ...target, start } } as never)).toMatchObject({
        ok: false,
        success: false,
        reason: SUPERDOC_UI_REASONS.targetUnresolved,
      });
      expect(apply).not.toHaveBeenCalled();
    } finally {
      ui.destroy();
    }
  });
});
