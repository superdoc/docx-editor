import { describe, expect, it } from 'bun:test';
import { normalizeRunAttrsFromOoxml } from './run-attrs.js';

describe('DOCX fallback metadata', () => {
  const fontTable = {
    'Missing Modern': { family: 'modern' },
    'Missing Pitch': { pitch: 'fixed' },
    'Missing Conflict': { family: 'swiss', pitch: 'fixed' },
    'Missing Roman': { family: 'roman' },
    'Missing Swiss': { family: 'swiss' },
  };
  for (const [name, generic] of [
    ['Missing Modern', 'monospace'],
    ['Missing Pitch', 'monospace'],
    ['Missing Conflict', 'monospace'],
    ['Missing Roman', 'serif'],
    ['Missing Swiss', 'sans-serif'],
  ]) {
    it(`normalizes ${name} using font-table metadata`, () => {
      const attrs = normalizeRunAttrsFromOoxml({ fontFamily: { ascii: name } }, { fontTable });
      expect(attrs.fontFamily?.split(',').at(-1)?.trim()).toBe(generic);
    });
  }
  it('resolves theme references before looking up metadata', () => {
    const attrs = normalizeRunAttrsFromOoxml(
      { fontFamily: { asciiTheme: 'majorHAnsi' } },
      {
        fontTable,
        themeFontScheme: { major: { latin: 'Missing Modern' }, minor: { latin: 'Arial' } },
      },
    );
    expect(attrs.fontFamily?.split(',').at(-1)?.trim()).toBe('monospace');
  });
});
