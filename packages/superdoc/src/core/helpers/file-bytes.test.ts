import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vite-plus/test';
import { documentByteSourceToBlob, normalizeDocumentEntry } from './file.js';

const PDF = 'application/pdf';

const viewedBytes = async (blob: Blob) => Array.from(new Uint8Array(await blob.arrayBuffer()));

describe('document byte sources', () => {
  it('copies only the bytes a Uint8Array view covers, not its whole backing buffer', async () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = new Uint8Array(backing.buffer, 2, 3);

    expect(await viewedBytes(documentByteSourceToBlob(view, PDF))).toEqual([1, 2, 3]);
  });

  it('copies only the viewed bytes of a Uint8Array from another realm', async () => {
    const foreignView: unknown = runInNewContext('new Uint8Array(new Uint8Array([9, 4, 5, 6, 9]).buffer, 1, 3)');
    expect(foreignView instanceof Uint8Array).toBe(false);

    const normalized = normalizeDocumentEntry({ data: foreignView as Uint8Array, type: PDF, name: 'a.pdf' });

    expect(normalized.data).toBeInstanceOf(Blob);
    expect(await viewedBytes(normalized.data as Blob)).toEqual([4, 5, 6]);
  });

  it('copies an ArrayBuffer byte for byte', async () => {
    expect(await viewedBytes(documentByteSourceToBlob(new Uint8Array([7, 8]).buffer, PDF))).toEqual([7, 8]);
  });
});

describe('normalizeDocumentEntry type for byte sources', () => {
  it('throws a named TypeError for a non-string type', () => {
    const entry = { data: new Uint8Array([1]), type: 7 };

    expect(() => normalizeDocumentEntry(entry as unknown as Parameters<typeof normalizeDocumentEntry>[0])).toThrow(
      new TypeError('SuperDoc: document type must be a string, received number'),
    );
  });

  it.each([
    ['pdf', PDF],
    [undefined, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ])('canonicalizes a %s type', (type, expected) => {
    expect(normalizeDocumentEntry({ data: new Uint8Array([1]), type }).type).toBe(expected);
  });
});
