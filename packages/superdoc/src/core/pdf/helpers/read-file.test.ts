import { describe, it, expect, beforeEach, afterEach } from 'vite-plus/test';
import { readFileAsArrayBuffer } from './read-file.js';

type ReaderOutcome = { result: string | ArrayBuffer | null } | { error: Error };

let nextOutcome: ReaderOutcome = { result: null };

class FakeReader {
  result: string | ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onerror: ((error: Error) => void) | null = null;

  readAsArrayBuffer() {
    const outcome = nextOutcome;
    queueMicrotask(() => {
      if ('error' in outcome) {
        this.onerror?.(outcome.error);
        return;
      }
      this.result = outcome.result;
      this.onload?.();
    });
  }
}

describe('readFileAsArrayBuffer with the real FileReader', () => {
  it('resolves an ArrayBuffer holding the blob bytes', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    const result = await readFileAsArrayBuffer(new Blob([bytes]));

    expect(Array.from(new Uint8Array(result))).toEqual(Array.from(bytes));
  });
});

describe('readFileAsArrayBuffer', () => {
  const originalFileReader = globalThis.FileReader;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'FileReader', { value: FakeReader, configurable: true, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'FileReader', { value: originalFileReader, configurable: true, writable: true });
  });

  it('resolves with the ArrayBuffer the reader produces', async () => {
    const buffer = new ArrayBuffer(3);
    nextOutcome = { result: buffer };
    const result = await readFileAsArrayBuffer(new Blob(['abc']));
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result).toBe(buffer);
  });

  it('rejects with a TypeError when the reader result is not an ArrayBuffer', async () => {
    nextOutcome = { result: 'data:application/pdf;base64,YWJj' };
    await expect(readFileAsArrayBuffer(new Blob(['abc']))).rejects.toThrow(TypeError);
  });

  it('rejects when the reader emits an error', async () => {
    nextOutcome = { error: new Error('bad read') };
    await expect(readFileAsArrayBuffer(new Blob(['abc']))).rejects.toThrow('bad read');
  });
});
