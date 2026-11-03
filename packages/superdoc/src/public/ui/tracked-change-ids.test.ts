import { describe, expect, it } from 'vite-plus/test';
import { EMPTY_SELECTION } from './selection-targets.js';
import { buildTrackedChangeIdContext, resolveSelectionActiveChangeId } from './tracked-change-ids.js';
import type { StoryLocator } from '@superdoc/document-api';
import type { SelectionSlice } from './types.js';

const BODY: StoryLocator = { kind: 'story', storyType: 'body' };
const TEXTBOX: StoryLocator = { kind: 'story', storyType: 'textbox', textboxId: 'tb1' };

function selectionIn(story: StoryLocator): SelectionSlice {
  return {
    ...EMPTY_SELECTION,
    empty: false,
    target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 1 } }], story },
  };
}

describe('buildTrackedChangeIdContext', () => {
  it('maps the raw Word id and the painter imported form back to the public id', () => {
    const context = buildTrackedChangeIdContext([{ id: 'tc-1', sourceIds: { wordIdInsert: '27' } }]);
    expect(context.toPublicId('27')).toBe('tc-1');
    expect(context.toPublicId('imported:27')).toBe('tc-1');
    expect(context.aliasesFor('tc-1')).toEqual(['tc-1', '27', 'imported:27']);
  });

  it('never lets an alias override a real public id', () => {
    const context = buildTrackedChangeIdContext([{ id: 'tc-1', sourceIds: { wordIdInsert: 'tc-2' } }, { id: 'tc-2' }]);
    expect(context.toPublicId('tc-2')).toBe('tc-2');
  });
});

describe('resolveSelectionActiveChangeId', () => {
  it('keeps a body selection off a story-less row that shares its Word revision id', () => {
    const allStoryItems = [
      { id: 'textbox-change', sourceIds: { wordIdInsert: '5' } },
      { id: 'body-change', sourceIds: { wordIdInsert: '5' }, storyLocator: BODY },
    ];
    expect(
      resolveSelectionActiveChangeId({
        selectionIds: ['imported:5'],
        selection: selectionIn(BODY),
        bodyItems: allStoryItems,
        allStoryItems,
      }),
    ).toBe('body-change');
  });

  it('fails closed in a textbox when two story-less candidates share a revision id', () => {
    const allStoryItems = [
      { id: 'a', sourceIds: { wordIdInsert: '9' } },
      { id: 'b', sourceIds: { wordIdInsert: '9' } },
    ];
    expect(
      resolveSelectionActiveChangeId({
        selectionIds: ['a', 'b'],
        selection: selectionIn(TEXTBOX),
        bodyItems: [],
        allStoryItems,
      }),
    ).toBeNull();
  });

  it('takes the first of several independent textbox changes', () => {
    const allStoryItems = [
      { id: 'a', sourceIds: { wordIdInsert: '1' } },
      { id: 'b', sourceIds: { wordIdInsert: '2' } },
    ];
    expect(
      resolveSelectionActiveChangeId({
        selectionIds: ['a', 'b'],
        selection: selectionIn(TEXTBOX),
        bodyItems: [],
        allStoryItems,
      }),
    ).toBe('a');
  });

  it('publishes nothing for a non-body selection before the all-story catalog settles', () => {
    expect(
      resolveSelectionActiveChangeId({
        selectionIds: ['x'],
        selection: selectionIn(TEXTBOX),
        bodyItems: [{ id: 'x' }],
        allStoryItems: null,
      }),
    ).toBeNull();
  });
});
