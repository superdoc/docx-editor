import { describe, expect, it } from 'vite-plus/test';
import { getSuperDocUiOwnerId } from './superdoc-ui-owner.js';

describe('editor UI ownership', () => {
  it('keeps an editor identity stable and isolates separate instances', () => {
    const a = {};
    const b = {};
    expect(getSuperDocUiOwnerId(a)).toBe(getSuperDocUiOwnerId(a));
    expect(getSuperDocUiOwnerId(a)).not.toBe(getSuperDocUiOwnerId(b));
    expect(getSuperDocUiOwnerId(null)).toBeNull();
  });
});
