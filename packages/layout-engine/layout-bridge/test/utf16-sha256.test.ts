import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vite-plus/test';
import { Utf16Sha256 } from '../src/utf16-sha256.js';

describe('streaming UTF-16 measurement digest', () => {
  it('matches the SHA-256 empty-message vector', () => {
    expect(new Utf16Sha256().digestHex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it.each([1, 27, 28, 31, 32, 33, 55, 56, 63, 64, 65, 257, 65_537])(
    'matches Node crypto across compression and padding boundaries at length %i',
    (length) => {
      const input = 'a\u0000\u00e9\ud800\udc00\ud801\ufffd'.repeat(Math.ceil(length / 7)).slice(0, length);
      const expected = createHash('sha256').update(Buffer.from(input, 'utf16le')).digest('hex');
      for (const chunkSize of [1, 7, 31, 32, 1_024]) {
        const writer = new Utf16Sha256();
        for (let index = 0; index < input.length; index += chunkSize)
          writer.write(input.slice(index, index + chunkSize));
        expect(writer.digestHex()).toBe(expected);
      }
    },
  );

  it('rejects appending or finalizing again after producing a digest', () => {
    const writer = new Utf16Sha256();
    writer.write('abc');
    writer.digestHex();
    expect(() => writer.write('def')).toThrow('finalized');
    expect(() => writer.digestHex()).toThrow('finalized');
  });
});
