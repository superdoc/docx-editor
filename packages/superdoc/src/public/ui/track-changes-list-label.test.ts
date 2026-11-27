import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createSuperDocUI } from './create-super-doc-ui.js';

const rows = [
  { id: 'split', type: 'structural', subtype: 'paragraph-mark-insertion', targetIsListItem: true },
  { id: 'plain-split', type: 'structural', subtype: 'paragraph-mark-insertion', targetIsListItem: false },
  { id: 'merge', type: 'structural', subtype: 'paragraph-mark-deletion', listActionKind: 'merge-items' },
  {
    id: 'removed',
    type: 'formatting',
    subtype: 'list-formatting',
    excerpt: 'Charlie',
    listDeltas: [
      {
        kind: 'list-remove',
        from: { hasNumPr: true, numId: '1', ilvl: 0, styleKind: 'number' },
        to: { hasNumPr: false, numId: null, ilvl: null, styleKind: null },
      },
    ],
    listDeltaSummary: { uniformKind: 'list-remove', counts: { 'list-remove': 1 } },
  },
  { id: 'typed', type: 'insertion', insertedText: 'Delta' },
];

const mounted: ReturnType<typeof createSuperDocUI>[] = [];
afterEach(() => mounted.splice(0).forEach((ui) => ui.destroy()));

function mount(surface: 'window' | 'directory') {
  const listeners = new Map<string, Set<() => void>>();
  const editor = {
    editorVersion: 2,
    host: { events: { subscribe: () => () => undefined } },
    ...(surface === 'window'
      ? { reviewWindow: { getSnapshot: () => ({ status: 'ready', trackedChangeItems: rows, commentItems: [] }) } }
      : {}),
    doc: {
      selection: { current: () => ({ empty: true, activeChangeIds: [], activeCommentIds: [], activeMarks: [] }) },
      trackChanges: { list: async () => ({ items: rows }) },
    },
  };
  const superdoc = {
    activeEditor: editor,
    config: { documentMode: 'editing', user: { name: 'Alice' } },
    on(event: string, listener: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(listener);
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
  };
  const ui = createSuperDocUI({ superdoc: superdoc as never });
  mounted.push(ui);
  return ui;
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('ui.trackChanges listLabel', () => {
  it.each(['window', 'directory'] as const)('labels list changes like the review card (%s)', async (surface) => {
    const ui = mount(surface);
    let snapshot = ui.trackChanges.getSnapshot();
    const stop = ui.trackChanges.observe((value) => {
      snapshot = value;
    });
    await settle();
    expect(snapshot.items.map(({ id, listLabel }) => [id, listLabel])).toEqual([
      ['split', 'Split list item'],
      ['plain-split', undefined],
      ['merge', 'Merged list items'],
      ['removed', 'Removed from list'],
      ['typed', undefined],
    ]);
    expect(snapshot.items.find(({ id }) => id === 'typed')).not.toHaveProperty('listLabel');
    stop();
  });
});
