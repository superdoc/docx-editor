/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { DOCX, PDF } from '@superdoc/common';
import { SuperDoc } from './SuperDoc.js';
import type { Config, DocumentSource } from './types/index.js';

const instances: SuperDoc[] = [];

function createInstance(document: DocumentSource): SuperDoc {
  return createConfiguredInstance({ document });
}

function createConfiguredInstance(config: Pick<Config, 'document' | 'documents'>): SuperDoc {
  const selector = window.document.createElement('div');
  window.document.body.append(selector);

  const instance = new SuperDoc({ selector, ...config, telemetry: { enabled: false } });
  instances.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  window.document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Config.document sources', () => {
  it('advertises DOCX and PDF viewers without a standalone HTML viewer', () => {
    const instance = createInstance('/contract.docx');

    expect(SuperDoc.allowedTypes).toEqual([DOCX, PDF]);
    expect(instance.getV2FeatureMatrix().some(({ feature }) => feature === 'html.viewer')).toBe(false);
  });

  it('opens a URL string as a DOCX source', () => {
    const instance = createInstance('/contract.docx');

    expect(instance.config.documents).toHaveLength(1);
    expect(instance.config.documents[0]).toMatchObject({
      type: DOCX,
      url: '/contract.docx',
      name: 'document.docx',
    });
  });

  it('preserves a direct File source', () => {
    const data = new File(['content'], 'contract.docx', { type: DOCX });
    const instance = createInstance(data);

    expect(instance.config.documents).toHaveLength(1);
    expect(instance.config.documents[0]).toMatchObject({ type: DOCX, name: 'contract.docx', data });
  });

  it('opens a direct Blob source with its fallback name', () => {
    const instance = createInstance(new Blob(['content'], { type: DOCX }));
    const document = instance.config.documents[0];

    expect(instance.config.documents).toHaveLength(1);
    expect(document).toMatchObject({ type: DOCX, name: 'document', data: expect.any(File) });
    expect(document.data).toMatchObject({ name: 'document', type: DOCX });
  });

  it('preserves the filename supplied by an upload wrapper', () => {
    const instance = createInstance({
      uid: 'upload-1',
      name: 'report.pdf',
      originFileObj: new Blob(['%PDF'], { type: '' }),
    });
    const document = instance.config.documents[0];

    expect(document).toMatchObject({ type: PDF, name: 'report.pdf', data: expect.any(File) });
    expect(document.data).toMatchObject({ name: 'report.pdf', type: PDF });
  });

  it('preserves metadata on a structured File source', () => {
    const data = new File(['content'], 'upload.docx', { type: DOCX });
    const instance = createInstance({
      id: 'contract-1',
      data,
      name: 'contract.docx',
      type: 'docx',
      password: 'secret',
    });

    expect(instance.config.documents).toEqual([
      expect.objectContaining({
        id: 'contract-1',
        data,
        name: 'contract.docx',
        type: DOCX,
        password: 'secret',
      }),
    ]);
  });

  it('preserves IDs on documents entries', () => {
    const data = new File(['content'], 'contract.docx', { type: DOCX });
    const instance = createConfiguredInstance({
      documents: [{ id: 'contract-1', data, name: 'contract.docx', type: DOCX }],
    });

    expect(instance.config.documents).toEqual([
      expect.objectContaining({ id: 'contract-1', data, name: 'contract.docx', type: DOCX }),
    ]);
  });

  it('keeps document precedence when document and documents are both set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const preferred = new File(['preferred'], 'preferred.docx', { type: DOCX });
    const ignored = new File(['ignored'], 'ignored.docx', { type: DOCX });
    const instance = createConfiguredInstance({
      document: { data: preferred, name: preferred.name, type: DOCX },
      documents: [{ id: 'ignored', data: ignored, name: ignored.name, type: DOCX }],
    });

    expect(warn).toHaveBeenCalledWith('🦋 [superdoc] You can only provide one of document or documents');
    expect(instance.config.documents).toEqual([
      expect.objectContaining({ data: preferred, name: preferred.name, type: DOCX }),
    ]);
  });

  it.each([
    ['ArrayBuffer', new Uint8Array([1, 2, 3, 4]).buffer, false],
    ['Uint8Array', new Uint8Array([1, 2, 3, 4]), true],
  ])('opens a direct %s as a DOCX source', (_label, data, preservesIdentity) => {
    const instance = createInstance(data);
    const document = instance.config.documents[0];

    expect(instance.config.documents).toHaveLength(1);
    expect(document).toMatchObject({
      type: DOCX,
      name: 'document.docx',
    });
    expect(document.data).toBeInstanceOf(Uint8Array);
    if (preservesIdentity) expect(document.data).toBe(data);
    else expect(document.data).not.toBe(data);
    expect(document.data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('preserves metadata on a structured byte source', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const instance = createInstance({ data, name: 'contract.docx', password: 'secret' });
    const document = instance.config.documents[0];

    expect(document).toMatchObject({
      type: DOCX,
      name: 'contract.docx',
      password: 'secret',
    });
    expect(document.data).toBeInstanceOf(Uint8Array);
    expect(document.data).toBe(data);
    expect(document.data).toEqual(data);
  });

  it.each(['ArrayBuffer', 'Uint8Array'] as const)('opens a cross-realm %s as a DOCX source', (kind) => {
    const iframe = window.document.createElement('iframe');
    window.document.body.append(iframe);
    const foreignWindow = iframe.contentWindow!.window;
    const data =
      kind === 'ArrayBuffer'
        ? new foreignWindow.Uint8Array([1, 2, 3, 4]).buffer
        : new foreignWindow.Uint8Array([1, 2, 3, 4]);

    expect(data).not.toBeInstanceOf(kind === 'ArrayBuffer' ? ArrayBuffer : Uint8Array);

    const instance = createInstance(data);
    const document = instance.config.documents[0];

    expect(instance.config.documents).toHaveLength(1);
    expect(document).toMatchObject({
      type: DOCX,
      name: 'document.docx',
    });
    expect(document.data).toBeInstanceOf(Uint8Array);
    expect(document.data).not.toBe(data);
    expect(document.data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('reports a Blob to content-error handlers for byte-backed documents', () => {
    const instance = createInstance(new Uint8Array([1, 2, 3, 4]));
    const onContentError = vi.fn();
    instance.config.onContentError = onContentError;
    (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = {
      documents: [{ id: 'byte-docx', type: DOCX, data: new Uint8Array([1, 2, 3, 4]) }],
    };

    instance.onContentError({
      error: new Error('invalid content'),
      editor: { options: { documentId: 'byte-docx' } } as never,
    });

    expect(onContentError).toHaveBeenCalledOnce();
    const source = onContentError.mock.calls[0][0].file;
    expect(source).toBeInstanceOf(Blob);
    expect(source.type).toBe(DOCX);
    expect(source.size).toBe(4);
  });

  it.each([
    ['File', new File(['content'], 'contract.docx', { type: DOCX })],
    ['Blob', new Blob(['content'], { type: DOCX })],
  ])('preserves a local %s in content-error payloads', (_label, source) => {
    const instance = createInstance(source);
    const onContentError = vi.fn();
    instance.config.onContentError = onContentError;
    (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = {
      documents: [{ id: 'contract-1', type: DOCX, data: source }],
    };

    instance.onContentError({
      error: new Error('invalid content'),
      editor: { options: { documentId: 'contract-1' } } as never,
    });

    expect(onContentError).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'contract-1', file: source }));
  });

  it('exposes byte-backed DOCX data as a Blob through public state', () => {
    const instance = createInstance(new Uint8Array([1, 2, 3, 4]));
    const data = new Uint8Array([1, 2, 3, 4]);
    const store = { documents: [{ id: 'byte-docx', type: DOCX, data }] };
    (instance as unknown as { superdocStore: typeof store }).superdocStore = store;

    const document = instance.state.documents[0];

    expect(document.data).toBeInstanceOf(Blob);
    expect(document.data?.type).toBe(DOCX);
    expect(document.data?.size).toBe(data.byteLength);
    expect(store.documents[0].data).toBe(data);
  });
});
