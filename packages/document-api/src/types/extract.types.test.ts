import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vite-plus/test';

const source = new URL('./extract.types.ts', import.meta.url);

describe('shared extract types stay surface-neutral', () => {
  it("does not prescribe one surface's tracked-change replacement spelling", async () => {
    const text = await readFile(source, 'utf8');
    const prescribes = /set\s+`?trackChanges\.(replacementMode|replacements)/u.test(text);
    // This type ships to the browser Config surface and to the Node SDK/CLI, whose `open`
    // contract accepts only `trackChanges.replacements` and rejects `replacementMode` with
    // INVALID_ARGUMENT. Naming one spelling as the thing to set sends half the consumers
    // down a path their surface refuses.
    expect(prescribes).toBe(false);

    if (/replacementMode/u.test(text)) {
      expect(text).toMatch(/trackChanges\.replacements/u);
    }
  });
});
