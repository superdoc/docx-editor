import { describe, expect, it } from 'vite-plus/test';
import {
  BODY_TRACKED_CHANGE_STORY,
  buildBodyTrackedChangeAnchorKey,
  buildTrackedChangeAnchorKeyForStory,
  buildTrackedChangeImportedPositionId,
  getTrackedChangeStoryKey,
  isBodyTrackedChangeComment,
  makeTrackedChangeAnchorKey,
  normalizeCommentId,
  normalizeTrackedChangePositionAliases,
  normalizeTrackedChangeStoryKey,
  parseTrackedChangeAnchorKey,
  positionEntryMatchesTrackedChangeStory,
  trackedChangeStoryKeysAreCompatible,
} from './tracked-change-identity.js';

const FOOTNOTE_STORY = { kind: 'story', storyType: 'footnote', noteId: '3' } as const;
const HEADER_PART_STORY = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId7' } as const;

describe('normalizeCommentId', () => {
  it('stringifies ids and reads null and undefined as null', () => {
    expect(normalizeCommentId(undefined)).toBeNull();
    expect(normalizeCommentId(null)).toBeNull();
    expect(normalizeCommentId(0)).toBe('0');
    expect(normalizeCommentId('')).toBe('');
    expect(normalizeCommentId('c1')).toBe('c1');
  });
});

describe('makeTrackedChangeAnchorKey', () => {
  it('joins the story key and raw id', () => {
    expect(makeTrackedChangeAnchorKey({ storyKey: 'footnote:2', rawId: '7' })).toBe('tc::footnote:2::7');
  });
});

describe('parseTrackedChangeAnchorKey', () => {
  it('splits the story key from the raw id at the first separator', () => {
    expect(parseTrackedChangeAnchorKey('tc::body::12')).toEqual({ storyKey: 'body', rawId: '12' });
    expect(parseTrackedChangeAnchorKey('tc::hf:rId7::5')).toEqual({ storyKey: 'hf:rId7', rawId: '5' });
    expect(parseTrackedChangeAnchorKey('tc::fn:1::a::b')).toEqual({ storyKey: 'fn:1', rawId: 'a::b' });
  });

  it('round-trips a built anchor key', () => {
    expect(parseTrackedChangeAnchorKey(makeTrackedChangeAnchorKey({ storyKey: 'en:4', rawId: '9' }))).toEqual({
      storyKey: 'en:4',
      rawId: '9',
    });
    expect(parseTrackedChangeAnchorKey(buildBodyTrackedChangeAnchorKey(31))).toEqual({ storyKey: 'body', rawId: '31' });
  });

  it('rejects keys without the prefix, a story key or a raw id', () => {
    expect(parseTrackedChangeAnchorKey(null)).toBeNull();
    expect(parseTrackedChangeAnchorKey(undefined)).toBeNull();
    expect(parseTrackedChangeAnchorKey(5)).toBeNull();
    expect(parseTrackedChangeAnchorKey('body::1')).toBeNull();
    expect(parseTrackedChangeAnchorKey('tc::body')).toBeNull();
    expect(parseTrackedChangeAnchorKey('tc::::5')).toBeNull();
    expect(parseTrackedChangeAnchorKey('tc::body::')).toBeNull();
  });
});

describe('buildBodyTrackedChangeAnchorKey', () => {
  it('builds a body anchor key for any id except null and undefined', () => {
    expect(buildBodyTrackedChangeAnchorKey(12)).toBe('tc::body::12');
    expect(buildBodyTrackedChangeAnchorKey(0)).toBe('tc::body::0');
    expect(buildBodyTrackedChangeAnchorKey('')).toBe('tc::body::');
    expect(buildBodyTrackedChangeAnchorKey(null)).toBeNull();
    expect(buildBodyTrackedChangeAnchorKey(undefined)).toBeNull();
  });
});

describe('buildTrackedChangeAnchorKeyForStory', () => {
  it('builds an anchor key in the given story and falls back to body', () => {
    expect(buildTrackedChangeAnchorKeyForStory('fn:2', 7)).toBe('tc::fn:2::7');
    expect(buildTrackedChangeAnchorKeyForStory(null, 'a')).toBe('tc::body::a');
    expect(buildTrackedChangeAnchorKeyForStory('', 'a')).toBe('tc::body::a');
    expect(buildTrackedChangeAnchorKeyForStory('hf:rId1', null)).toBeNull();
    expect(buildTrackedChangeAnchorKeyForStory('hf:rId1', undefined)).toBeNull();
  });
});

describe('isBodyTrackedChangeComment', () => {
  it('reads tracked changes without a story, or in the body story, as body', () => {
    expect(isBodyTrackedChangeComment({ trackedChange: true })).toBe(true);
    expect(isBodyTrackedChangeComment({ trackedChange: true, trackedChangeStory: null })).toBe(true);
    expect(isBodyTrackedChangeComment({ trackedChange: true, trackedChangeStory: BODY_TRACKED_CHANGE_STORY })).toBe(
      true,
    );
  });

  it('reads a non-body story as body only when its anchor key is a body key', () => {
    expect(isBodyTrackedChangeComment({ trackedChange: true, trackedChangeStory: FOOTNOTE_STORY })).toBe(false);
    expect(
      isBodyTrackedChangeComment({
        trackedChange: true,
        trackedChangeStory: FOOTNOTE_STORY,
        trackedChangeAnchorKey: 'tc::body::3',
      }),
    ).toBe(true);
    expect(
      isBodyTrackedChangeComment({
        trackedChange: true,
        trackedChangeStory: HEADER_PART_STORY,
        trackedChangeAnchorKey: 'tc::hf:rId7::3',
      }),
    ).toBe(false);
  });

  it('rejects comments that are not tracked changes', () => {
    expect(isBodyTrackedChangeComment(null)).toBe(false);
    expect(isBodyTrackedChangeComment(undefined)).toBe(false);
    expect(isBodyTrackedChangeComment({ trackedChange: false, trackedChangeStory: BODY_TRACKED_CHANGE_STORY })).toBe(
      false,
    );
  });
});

describe('getTrackedChangeStoryKey', () => {
  it('derives the story key from the story locator', () => {
    expect(getTrackedChangeStoryKey({ trackedChange: true, trackedChangeStory: BODY_TRACKED_CHANGE_STORY })).toBe(
      'body',
    );
    expect(getTrackedChangeStoryKey({ trackedChange: true, trackedChangeStory: HEADER_PART_STORY })).toBe('hf:rId7');
    expect(getTrackedChangeStoryKey({ trackedChange: true, trackedChangeStory: FOOTNOTE_STORY })).toBe('fn:3');
    expect(
      getTrackedChangeStoryKey({
        trackedChange: true,
        trackedChangeStory: { kind: 'story', storyType: 'endnote', noteId: '4' },
      }),
    ).toBe('en:4');
    expect(
      getTrackedChangeStoryKey({
        trackedChange: true,
        trackedChangeStory: { kind: 'story', storyType: 'textbox', textboxId: 'tb1' },
      }),
    ).toBe('textbox:tb1');
  });

  it('prefers the anchor key story over the locator', () => {
    expect(
      getTrackedChangeStoryKey({
        trackedChange: true,
        trackedChangeStory: BODY_TRACKED_CHANGE_STORY,
        trackedChangeAnchorKey: 'tc::fn:9::1',
      }),
    ).toBe('fn:9');
    expect(
      getTrackedChangeStoryKey({
        trackedChange: true,
        trackedChangeStory: FOOTNOTE_STORY,
        trackedChangeAnchorKey: 'not-an-anchor',
      }),
    ).toBe('fn:3');
  });

  it('returns null without a tracked change, a story, or a story id', () => {
    expect(getTrackedChangeStoryKey(null)).toBeNull();
    expect(getTrackedChangeStoryKey({ trackedChange: false, trackedChangeAnchorKey: 'tc::body::1' })).toBeNull();
    expect(getTrackedChangeStoryKey({ trackedChange: true })).toBeNull();
    expect(
      getTrackedChangeStoryKey({
        trackedChange: true,
        trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: '' },
      }),
    ).toBeNull();
    expect(
      getTrackedChangeStoryKey({
        trackedChange: true,
        trackedChangeStory: {
          kind: 'story',
          storyType: 'headerFooterSlot',
          section: { kind: 'section', sectionId: 's1' },
          headerFooterKind: 'header',
          variant: 'default',
        },
      }),
    ).toBeNull();
  });
});

describe('normalizeTrackedChangeStoryKey', () => {
  it('rewrites header and footer part keys to the hf: form', () => {
    expect(normalizeTrackedChangeStoryKey('hf:part:rId7')).toBe('hf:rId7');
    expect(normalizeTrackedChangeStoryKey('headerFooterPart:rId7')).toBe('hf:rId7');
  });

  it('keeps other keys as they are', () => {
    expect(normalizeTrackedChangeStoryKey('hf:rId7')).toBe('hf:rId7');
    expect(normalizeTrackedChangeStoryKey('body')).toBe('body');
    expect(normalizeTrackedChangeStoryKey('fn:1')).toBe('fn:1');
    expect(normalizeTrackedChangeStoryKey('')).toBe('');
    expect(normalizeTrackedChangeStoryKey(null)).toBeNull();
  });
});

describe('trackedChangeStoryKeysAreCompatible', () => {
  it('matches equal keys after normalization', () => {
    expect(trackedChangeStoryKeysAreCompatible('body', 'body')).toBe(true);
    expect(trackedChangeStoryKeysAreCompatible('hf:part:rId7', 'hf:rId7')).toBe(true);
    expect(trackedChangeStoryKeysAreCompatible('headerFooterPart:rId7', 'hf:part:rId7')).toBe(true);
  });

  it('rejects different keys', () => {
    expect(trackedChangeStoryKeysAreCompatible('body', 'fn:1')).toBe(false);
    expect(trackedChangeStoryKeysAreCompatible('hf:rId7', 'hf:rId8')).toBe(false);
  });

  it('treats a missing key on either side as compatible', () => {
    expect(trackedChangeStoryKeysAreCompatible(null, 'fn:1')).toBe(true);
    expect(trackedChangeStoryKeysAreCompatible('body', null)).toBe(true);
    expect(trackedChangeStoryKeysAreCompatible('', 'fn:1')).toBe(true);
  });
});

describe('positionEntryMatchesTrackedChangeStory', () => {
  const headerComment = { trackedChange: true, trackedChangeStory: HEADER_PART_STORY };

  it('compares the entry story key with the comment story key', () => {
    expect(positionEntryMatchesTrackedChangeStory({ storyKey: 'hf:part:rId7' }, headerComment)).toBe(true);
    expect(positionEntryMatchesTrackedChangeStory({ storyKey: 'fn:1' }, headerComment)).toBe(false);
    expect(
      positionEntryMatchesTrackedChangeStory(
        { storyKey: 'headerFooterPart:rId7' },
        { trackedChange: true, trackedChangeAnchorKey: 'tc::hf:part:rId7::1' },
      ),
    ).toBe(true);
    expect(
      positionEntryMatchesTrackedChangeStory(
        { storyKey: 5 },
        { trackedChange: true, trackedChangeStory: BODY_TRACKED_CHANGE_STORY },
      ),
    ).toBe(false);
  });

  it('matches when either side has no story key', () => {
    expect(positionEntryMatchesTrackedChangeStory({}, headerComment)).toBe(true);
    expect(positionEntryMatchesTrackedChangeStory(null, headerComment)).toBe(true);
    expect(positionEntryMatchesTrackedChangeStory({ storyKey: 'fn:1' }, { trackedChange: false })).toBe(true);
  });
});

describe('normalizeTrackedChangePositionAliases', () => {
  it('stringifies, drops empty ids and dedupes in order', () => {
    expect(normalizeTrackedChangePositionAliases([1, '1', null, '', undefined, 'a', 'a', 0])).toEqual(['1', 'a', '0']);
  });

  it('reads non-arrays as no aliases', () => {
    expect(normalizeTrackedChangePositionAliases(undefined)).toEqual([]);
    expect(normalizeTrackedChangePositionAliases('a')).toEqual([]);
  });
});

describe('buildTrackedChangeImportedPositionId', () => {
  it('prefixes the id with imported: once', () => {
    expect(buildTrackedChangeImportedPositionId(5)).toBe('imported:5');
    expect(buildTrackedChangeImportedPositionId(0)).toBe('imported:0');
    expect(buildTrackedChangeImportedPositionId('imported:5')).toBe('imported:5');
  });

  it('returns null for empty ids', () => {
    expect(buildTrackedChangeImportedPositionId(null)).toBeNull();
    expect(buildTrackedChangeImportedPositionId(undefined)).toBeNull();
    expect(buildTrackedChangeImportedPositionId('')).toBeNull();
  });
});
