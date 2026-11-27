import { describe, expect, it, vi } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';

const body = { kind: 'story', storyType: 'body' };

function selectionInfo(blockId = 'P1', offset = 1) {
  return {
    empty: true,
    target: { kind: 'text', segments: [{ blockId, range: { start: offset, end: offset } }] },
    activeMarks: [],
    activeCommentIds: [],
    activeChangeIds: [],
  };
}

function presentationInfo() {
  const state = { success: true, isListItem: true, seed: 'bullet', ilvl: 0 };
  return {
    selection: selectionInfo(),
    inlineStyle: {},
    paragraphAlignments: [],
    listState: { blockId: 'P1', story: body, value: state },
  };
}

type AppliedPresentation = ReturnType<typeof presentationInfo>;

const caretBlockRequest = JSON.stringify({
  target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
  story: body,
});

function mount(transform: (presentation: AppliedPresentation) => unknown) {
  const presentation = presentationInfo();
  const reads: string[] = [];
  const superdoc = {
    activeEditor: {
      editorVersion: 2,
      host: {
        readAppliedSelectionPresentation: () => transform(presentation),
        getAppliedListState: () => {
          reads.push('host.getAppliedListState()');
          return { success: true, isListItem: false };
        },
      },
      doc: {
        selection: {
          current: () => presentation.selection,
        },
        lists: {
          getStateInStory: (request: unknown) => {
            reads.push(`doc.lists.getStateInStory(${JSON.stringify(request)})`);
            return JSON.stringify(request) === caretBlockRequest
              ? { success: true, isListItem: true, seed: 'ordered', ilvl: 0 }
              : { success: true, isListItem: false };
          },
          apply: vi.fn(),
          remove: vi.fn(),
        },
      },
    },
  };
  return { ui: createSuperDocUI({ superdoc: superdoc as never }), reads };
}

const cases: Array<[string, (value: AppliedPresentation) => unknown]> = [
  ['current applied frame', (value) => value],
  ['unavailable presentation', () => null],
  ['missing list facts', (value) => ({ ...value, listState: null })],
  [
    'older presentation without list facts',
    (value) => ({ selection: value.selection, inlineStyle: value.inlineStyle }),
  ],
  ['missing bound story', (value) => ({ ...value, listState: { ...value.listState, story: null } })],
  ['invalid bound story', (value) => ({ ...value, listState: { ...value.listState, story: 'body' } })],
  ['different block', (value) => ({ ...value, listState: { ...value.listState, blockId: 'P2' } })],
  [
    'different story',
    (value) => ({
      ...value,
      listState: { ...value.listState, story: { kind: 'story', storyType: 'footnote', noteId: '1' } },
    }),
  ],
  ['different selection block', (value) => ({ ...value, selection: selectionInfo('P2') })],
  ['different selection offset', (value) => ({ ...value, selection: selectionInfo('P1', 2) })],
  ['unsuccessful list facts', (value) => ({ ...value, listState: { ...value.listState, value: { success: false } } })],
  [
    'array-shaped list facts',
    (value) => ({
      ...value,
      listState: { ...value.listState, value: Object.assign([], { success: true }) },
    }),
  ],
];

describe('toolbar list facts from the current applied frame', () => {
  it('shows the applied frame list when it matches the caret, and the document read otherwise', async () => {
    const lines = cases.map(([label, transform]) => {
      const { ui, reads } = mount(transform);
      try {
        const states = ['bullet-list', 'numbered-list'].map(
          (id) => `  ${id}: ${JSON.stringify(ui.commands.get(id).getState())}`,
        );
        const requests = [...new Set(reads)].map((read) => `    ${read}`);
        return [`${label}:`, ...states, `  list reads:${requests.length ? '' : ' none'}`, ...requests].join('\n');
      } finally {
        ui.destroy();
      }
    });
    await expect(
      `applied frame: bullet list at P1 in body\ndocument read of P1 in body: numbered list\nhost applied list state: not a list\n\n${lines.join('\n\n')}\n`,
    ).toMatchFileSnapshot('./__snapshots__/applied-list-state/list-states.txt');
  });
});
