import { describe, expect, it } from 'vite-plus/test';
import { bulletStyleButtons, numberedStyleButtons } from '../../internal/toolbar/built-in/list-style-buttons.js';
import { presetFromToolbarStyleKey, resolveDocOperation } from './command-results.js';

describe('resolveDocOperation', () => {
  const doc = {
    lists: { remove: () => 'removed', removeInStory: () => 'removed in story' },
    format: { strikethrough: () => 'struck' },
  };

  it('resolves catalog, alias, and internal routes on the document', () => {
    expect(resolveDocOperation(doc, 'lists.remove')?.()).toBe('removed');
    expect(resolveDocOperation(doc, 'format.strikethrough')?.()).toBe('struck');
    expect(resolveDocOperation(doc, 'lists.removeInStory')?.()).toBe('removed in story');
  });

  it('returns null for a known route the document does not implement', () => {
    expect(resolveDocOperation(doc, 'lists.indent')).toBeNull();
    expect(resolveDocOperation(null, 'lists.remove')).toBeNull();
  });

  it('rejects an unknown route at compile time and still returns null at runtime', () => {
    // @ts-expect-error 'lists.remov' is a typo, not a Document API route
    expect(resolveDocOperation(doc, 'lists.remov')).toBeNull();
  });
});

describe('presetFromToolbarStyleKey', () => {
  it('maps every built-in list style button to a Document API preset', () => {
    for (const { key } of [...bulletStyleButtons, ...numberedStyleButtons]) {
      expect(presetFromToolbarStyleKey(key), key).toEqual({ preset: expect.any(String), behavior: 'toggleStyle' });
    }
  });

  it('keeps the kind-level toggle for keys that are not style picks', () => {
    expect(presetFromToolbarStyleKey('not-a-style')).toEqual({});
  });
});
