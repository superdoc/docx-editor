import { describe, expect, it } from 'vite-plus/test';
import { bulletStyleButtons, numberedStyleButtons } from '../../internal/toolbar/built-in/list-style-buttons.js';
import { presetFromToolbarStyleKey } from './command-results.js';

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
