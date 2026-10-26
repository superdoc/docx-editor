import { createRequire } from 'node:module';

const stdlibRequire = createRequire(createRequire(import.meta.url).resolve('node-stdlib-browser/package.json'));

export const nodeStdlibEntries = {
  punycode: stdlibRequire.resolve('punycode/punycode.js'),
  string_decoder: stdlibRequire.resolve('string_decoder/lib/string_decoder.js'),
};

export function resolveNodeStdlibEntry(source) {
  const name = source.endsWith('/') ? source.slice(0, -1) : source;
  return Object.hasOwn(nodeStdlibEntries, name) ? nodeStdlibEntries[name] : null;
}

export function nodeStdlibEntriesPlugin() {
  return {
    name: 'node-stdlib-entries',
    enforce: 'pre',
    resolveId(source) {
      const id = resolveNodeStdlibEntry(source);
      return id ? { id } : null;
    },
  };
}
