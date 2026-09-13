import { describe, it, expect } from 'vite-plus/test';
import { extractBrowserFile, normalizeDocumentEntry } from './file.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const HTML = 'text/html';
const PDF = 'application/pdf';

describe('document collaboration configuration', () => {
  const collaboration = { providerType: 'hocuspocus', documentId: 'shared', serverUrl: 'wss://example.com' };
  const oldTarget = { documentId: 'old', serverUrl: 'wss://old.example.com' };

  for (const source of [
    { url: '/sample.docx', type: DOCX },
    { data: new Uint8Array([1, 2]), type: DOCX },
  ]) {
    it(`normalizes collaboration for ${'url' in source ? 'URL' : 'byte'} sources without mutating the caller`, () => {
      const input = Object.freeze({ ...source, collaboration, v2Collaboration: oldTarget });
      const normalized = normalizeDocumentEntry(input);
      expect(normalized.v2Collaboration).toBe(collaboration);
      expect(normalized).not.toHaveProperty('collaboration');
      expect(input.collaboration).toBe(collaboration);
      expect(input.v2Collaboration).toBe(oldTarget);
      expect(normalizeDocumentEntry(normalized).v2Collaboration).toBe(collaboration);
    });
  }

  it('preserves existing callers and explicit local-document intent', () => {
    expect(normalizeDocumentEntry({ type: DOCX, v2Collaboration: oldTarget }).v2Collaboration).toBe(oldTarget);
    expect(
      normalizeDocumentEntry({ type: DOCX, collaboration: null, v2Collaboration: oldTarget }).v2Collaboration,
    ).toBeNull();
    expect(
      normalizeDocumentEntry({ type: DOCX, collaboration: undefined, v2Collaboration: oldTarget }).v2Collaboration,
    ).toBe(oldTarget);
  });

  it('keeps connection settings when unwrapping an uploaded file', () => {
    const file = new File(['sample'], 'sample.docx', { type: DOCX });
    const normalized = normalizeDocumentEntry({ file, collaboration });
    expect(normalized.data).toBe(file);
    expect(normalized.v2Collaboration).toBe(collaboration);
  });

  it('preserves invalid input for preflight rejection rather than falling back to another room', () => {
    expect(
      normalizeDocumentEntry({ type: DOCX, collaboration: false, v2Collaboration: oldTarget }).v2Collaboration,
    ).toBe(false);
  });
});

describe('extractBrowserFile', () => {
  it('returns the same File instance when given a File', () => {
    const f = new File([new Blob(['abc'], { type: 'text/plain' })], 'note.txt', { type: 'text/plain' });
    const out = extractBrowserFile(f);
    expect(out).toBeInstanceOf(File);
    expect(out).toBe(f);
  });

  it('wraps a Blob into a File with default name', () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    const out = extractBrowserFile(blob);
    expect(out).toBeInstanceOf(File);
    expect(out.name).toBe('document');
    expect(out.type).toBe('application/pdf');
  });

  it('unwraps wrapper object via originFileObj', () => {
    const inner = new File([new Blob(['x'], { type: DOCX })], 'report.docx', { type: DOCX });
    const uploadFile = { uid: 'abc123', name: 'report.docx', originFileObj: inner };
    const out = extractBrowserFile(uploadFile);
    expect(out).toBe(inner);
  });

  it('unwraps objects using `file` or `raw` keys', () => {
    const inner = new File([new Blob(['x'], { type: DOCX })], 'a.docx', { type: DOCX });
    expect(extractBrowserFile({ file: inner })).toBe(inner);
    expect(extractBrowserFile({ raw: inner })).toBe(inner);
  });

  it('ignores uid and other extra props on File', () => {
    const rc = new File([new Blob(['x'], { type: DOCX })], 'b.docx', { type: DOCX });
    // simulate uploader adding uid
    // @ts-ignore
    rc.uid = 'rc-1';
    const out = extractBrowserFile(rc);
    expect(out).toBe(rc);
    expect(out.name).toBe('b.docx');
  });

  it('returns null for falsy inputs', () => {
    expect(extractBrowserFile(null)).toBeNull();
    expect(extractBrowserFile(undefined)).toBeNull();
  });
});

describe('normalizeDocumentEntry', () => {
  it('normalizes a plain File to document entry', () => {
    const f = new File([new Blob(['x'], { type: DOCX })], 'doc.docx', { type: DOCX });
    const out = normalizeDocumentEntry(f);
    expect(out).toMatchObject({
      name: 'doc.docx',
      type: DOCX,
    });
    expect(out.isNewFile).toBeUndefined();
    expect(out.data).toBeInstanceOf(File);
    expect(out.data).toBe(f);
  });

  it('infers type from filename when file.type is empty', () => {
    const f = new File([new Blob(['x'], { type: '' })], 'report.docx', { type: '' });
    const out = normalizeDocumentEntry(f);
    expect(out.type).toBe(DOCX);
  });

  it('wraps Blob and sets default name', () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    const out = normalizeDocumentEntry(blob);
    expect(out.type).toBe('application/pdf');
    expect(out.data).toBeInstanceOf(File);
    expect(out.name).toBe('document');
  });

  it('normalizes wrapper with originFileObj into document entry', () => {
    const inner = new File([new Blob(['x'], { type: DOCX })], 'x.docx', { type: DOCX });
    const uploadFile = { uid: 'u1', originFileObj: inner };
    const out = normalizeDocumentEntry(uploadFile);
    expect(out.data).toBe(inner);
    expect(out.type).toBe(DOCX);
    expect(out.name).toBe('x.docx');
  });

  it('uses an upload wrapper name when its Blob has no native name', () => {
    const uploadFile = {
      uid: 'u2',
      name: 'report.pdf',
      originFileObj: new Blob(['%PDF'], { type: '' }),
    };

    const out = normalizeDocumentEntry(uploadFile);

    expect(out.data).toBeInstanceOf(File);
    expect(out.data.name).toBe('report.pdf');
    expect(out.name).toBe('report.pdf');
    expect(out.type).toBe(PDF);
  });

  it.each([
    ['report.pdf', PDF],
    ['report.html', HTML],
  ])('uses the wrapper filename when the uploaded File has a generic MIME (%s)', (name, type) => {
    const uploadFile = {
      name,
      originFileObj: new File(['content'], 'upload.bin', { type: 'application/octet-stream' }),
    };

    const out = normalizeDocumentEntry(uploadFile);

    expect(out.type).toBe(type);
    expect(out.name).toBe(name);
    expect(out.data).toBeInstanceOf(File);
    expect(out.data.name).toBe(name);
    expect(out.data.type).toBe(type);
  });

  it('normalizes config objects with `data` wrapper', () => {
    const inner = new File([new Blob(['x'], { type: DOCX })], 'wrapped.docx', { type: DOCX });
    const cfg = { data: { originFileObj: inner }, name: 'prefer-this-name.docx', password: 'secret' };
    const out = normalizeDocumentEntry(cfg);
    expect(out.data).toBe(inner);
    expect(out.name).toBe('prefer-this-name.docx');
    expect(out.type).toBe(DOCX);
    expect(out.password).toBe('secret');
  });

  it('uses a structured name when its Blob has no native name or type', () => {
    const out = normalizeDocumentEntry({
      data: new Blob(['%PDF'], { type: '' }),
      name: 'report.pdf',
    });

    expect(out.data).toBeInstanceOf(File);
    expect(out.data.name).toBe('report.pdf');
    expect(out.data.type).toBe(PDF);
    expect(out.name).toBe('report.pdf');
    expect(out.type).toBe(PDF);
  });

  it.each([
    ['pdf', PDF],
    ['html', HTML],
  ])('uses an explicit %s type instead of a generic File MIME', (shorthand, type) => {
    const data = new File(['content'], `document.${shorthand}`, { type: 'application/octet-stream' });

    const out = normalizeDocumentEntry({ data, type: shorthand });

    expect(out.type).toBe(type);
    expect(out.data).toBeInstanceOf(File);
    expect(out.data.type).toBe(type);
  });

  it.each([
    [DOCX.toUpperCase(), DOCX, Uint8Array],
    [PDF.toUpperCase(), PDF, Blob],
    [HTML.toUpperCase(), HTML, Blob],
  ])('canonicalizes the supported MIME type %s', (inputType, type, dataType) => {
    const out = normalizeDocumentEntry({ data: new Uint8Array([1, 2, 3, 4]), type: inputType });

    expect(out.type).toBe(type);
    expect(out.data).toBeInstanceOf(dataType);
  });

  it.each([
    ['ArrayBuffer', new Uint8Array([1, 2, 3, 4]).buffer, false],
    ['Uint8Array', new Uint8Array([1, 2, 3, 4]), true],
  ])('normalizes a direct %s as DOCX data', (_label, data, preservesIdentity) => {
    const out = normalizeDocumentEntry(data);

    expect(out).toMatchObject({
      type: DOCX,
      name: 'document.docx',
    });
    expect(out.data).toBeInstanceOf(Uint8Array);
    if (preservesIdentity) expect(out.data).toBe(data);
    else expect(out.data).not.toBe(data);
    expect(out.data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('preserves structured metadata and localized DOCX bytes', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const entry = { data, type: DOCX, name: 'contract.docx', password: 'secret' };
    const out = normalizeDocumentEntry(entry);

    expect(out).toMatchObject({ type: DOCX, name: 'contract.docx', password: 'secret' });
    expect(out.data).toBeInstanceOf(Uint8Array);
    expect(out.data).toBe(data);
    expect(out.data).toEqual(data);
  });

  it.each([
    ['report.pdf', PDF],
    ['report.html', HTML],
    ['report.htm', HTML],
  ])('infers %s structured byte data from its filename', async (name, type) => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const out = normalizeDocumentEntry({ data, name });

    expect(out.type).toBe(type);
    expect(out.name).toBe(name);
    expect(out.data).toBeInstanceOf(Blob);
    expect(out.data.type).toBe(type);
    expect(new Uint8Array(await out.data.arrayBuffer())).toEqual(data);
  });

  it('reuses localized DOCX bytes on subsequent normalization passes', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const first = normalizeDocumentEntry({ data, type: DOCX, name: 'contract.docx' });
    const second = normalizeDocumentEntry(first);

    expect(first.data).toBe(data);
    expect(second.data).toBe(first.data);
  });

  it.each([
    ['HTML', HTML],
    ['PDF', PDF],
  ])('converts structured byte data to a Blob for the %s renderer', async (_label, type) => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const out = normalizeDocumentEntry({ data, type, name: `document.${_label.toLowerCase()}` });

    expect(out.type).toBe(type);
    expect(out.data).toBeInstanceOf(Blob);
    expect(new Uint8Array(await out.data.arrayBuffer())).toEqual(data);
  });

  it.each([
    ['docx', DOCX, Uint8Array],
    ['pdf', PDF, Blob],
    ['html', HTML, Blob],
  ])('canonicalizes the %s shorthand for structured byte data', async (shorthand, type, DataType) => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const out = normalizeDocumentEntry({ data, type: shorthand, name: `document.${shorthand}` });

    expect(out.type).toBe(type);
    expect(out.data).toBeInstanceOf(DataType);
    const bytes = out.data instanceof Blob ? new Uint8Array(await out.data.arrayBuffer()) : out.data;
    expect(bytes).toEqual(data);
  });

  it.each([
    ['DoCx', DOCX],
    ['PDF', PDF],
    ['HtMl', HTML],
  ])('canonicalizes the %s shorthand case-insensitively', (shorthand, type) => {
    const out = normalizeDocumentEntry({ data: new Uint8Array([1]), type: shorthand });

    expect(out.type).toBe(type);
  });

  it.each([
    ['docx', 'document.docx'],
    ['pdf', 'document.pdf'],
    ['html', 'document.html'],
  ])('uses a matching default filename for %s byte data', (type, name) => {
    const out = normalizeDocumentEntry({ data: new Uint8Array([1]), type });

    expect(out.name).toBe(name);
  });

  it('canonicalizes shorthand types for URL-based entries', () => {
    const cfg = { url: 'https://example.com/test.html', type: 'html', name: 'url.html' };
    const out = normalizeDocumentEntry(cfg);

    expect(out).toMatchObject({ url: cfg.url, type: HTML, name: cfg.name });
  });
});
