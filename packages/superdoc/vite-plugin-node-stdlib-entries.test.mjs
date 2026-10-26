import { describe, expect, it } from 'vite-plus/test';
import { existsSync } from 'node:fs';
import { nodeStdlibEntries, nodeStdlibEntriesPlugin } from './vite-plugin-node-stdlib-entries.mjs';

describe('nodeStdlibEntriesPlugin', () => {
  const plugin = nodeStdlibEntriesPlugin();

  it('resolves bare and trailing-slash specifiers to the same file', () => {
    for (const [name, entry] of Object.entries(nodeStdlibEntries)) {
      expect(existsSync(entry)).toBe(true);
      expect(plugin.resolveId(name)).toEqual({ id: entry });
      expect(plugin.resolveId(`${name}/`)).toEqual({ id: entry });
    }
  });

  it('leaves other specifiers to the next resolver', () => {
    expect(plugin.resolveId('punycode/punycode.js')).toBeNull();
    expect(plugin.resolveId('buffer/')).toBeNull();
    expect(plugin.resolveId('toString')).toBeNull();
  });
});
