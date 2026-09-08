/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { DOCX } from '@superdoc/common';
import { SuperDoc } from './SuperDoc.js';
import type { ExportParams } from './types/index.js';

const mountedInstances: SuperDoc[] = [];

function createInstance(): SuperDoc {
  const selector = document.createElement('div');
  document.body.append(selector);

  const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
  mountedInstances.push(instance);
  return instance;
}

function createDocxBlob(): Blob {
  return new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function createForeignByteSource(kind: 'ArrayBuffer' | 'Uint8Array'): ArrayBuffer | Uint8Array {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const foreignWindow = iframe.contentWindow!;
  return kind === 'ArrayBuffer' ? new foreignWindow.ArrayBuffer(4) : new foreignWindow.Uint8Array([1, 2, 3, 4]);
}

function createForeignDocxBlob(): Blob {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const foreignWindow = iframe.contentWindow!;
  return new foreignWindow.Blob([new foreignWindow.Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: DOCX });
}

afterEach(() => {
  for (const instance of mountedInstances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SuperDoc.export', () => {
  it.each([undefined, 'external', 'internal', 'clean'] as const)(
    'rejects a mounted v2 generation failure with commentsType %s',
    async (commentsType) => {
      const instance = createInstance();
      const error = new Error('DOCX generation failed');
      const editor = { editorVersion: 2, exportDocx: vi.fn().mockRejectedValue(error) };
      const doc = { id: 'edited-docx', type: DOCX, data: createDocxBlob(), getEditor: () => editor };
      (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = { documents: [doc] };
      const onException = vi.fn();
      instance.on('exception', onException);
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      await expect(instance.export({ triggerDownload: false, commentsType })).rejects.toBe(error);

      expect(editor.exportDocx).toHaveBeenCalledOnce();
      expect(onException).toHaveBeenCalledTimes(2);
      expect(onException).toHaveBeenNthCalledWith(1, { error, document: doc });
      expect(onException).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          error,
          diagnosticCode: 'RENDER_ERROR',
          diagnosticStage: 'export',
          severity: 'error',
          internalCode: 'Error',
          documentId: 'edited-docx',
          message: 'DOCX generation failed',
        }),
      );
      expect(click).not.toHaveBeenCalled();
    },
  );

  it('rejects an already bridged v2 generation error without emitting it twice', async () => {
    const instance = createInstance();
    const error = new Error('DOCX generation failed');
    const editor = {
      editorVersion: 2,
      exportDocx: vi.fn(async () => {
        instance.emit('exception', { error, editor });
        throw error;
      }),
    };
    (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = {
      documents: [{ id: 'edited-docx', type: DOCX, data: createDocxBlob(), getEditor: () => editor }],
    };
    const onException = vi.fn();
    instance.on('exception', onException);

    await expect(instance.export({ triggerDownload: false })).rejects.toBe(error);

    // Bridged errors must not also emit the translated diagnostic payload --
    // the editor's own internal emission already covers this incident.
    expect(onException).toHaveBeenCalledExactlyOnceWith({ error, editor });
  });

  it('returns the mounted v2 editor export instead of the opened file', async () => {
    const instance = createInstance();
    const original = createDocxBlob();
    const edited = createDocxBlob();
    const editor = { editorVersion: 2, exportDocx: vi.fn().mockResolvedValue(edited) };
    (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = {
      documents: [{ id: 'edited-docx', type: DOCX, data: original, getEditor: () => editor }],
    };

    await expect(instance.export({ triggerDownload: false })).resolves.toBe(edited);

    expect(editor.exportDocx).toHaveBeenCalledExactlyOnceWith({
      commentsType: 'external',
      isFinalDoc: false,
      fieldsHighlightColor: null,
    });
  });

  it.each([
    ['File', new File(['content'], 'contract.docx', { type: DOCX })],
    ['Blob', new Blob(['content'], { type: DOCX })],
  ])('uses a local %s as the DOCX export fallback', async (_label, data) => {
    const instance = createInstance();
    (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = {
      documents: [{ id: 'contract-1', type: DOCX, data, getEditor: () => null }],
    };

    await expect(instance.exportEditorsToDOCX()).resolves.toEqual([data]);
  });

  it.each(['ArrayBuffer', 'Uint8Array'] as const)('uses a cross-realm %s as the DOCX export fallback', async (kind) => {
    const instance = createInstance();
    const data = createForeignByteSource(kind);
    (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = {
      documents: [{ id: 'foreign-docx', type: DOCX, data, getEditor: () => null }],
    };

    const [exported] = await instance.exportEditorsToDOCX();

    expect(exported).toBeInstanceOf(Blob);
    expect(exported.type).toBe(DOCX);
    expect(exported.size).toBe(4);
  });

  it('preserves a cross-realm Blob as the DOCX export fallback', async () => {
    const instance = createInstance();
    const data = createForeignDocxBlob();
    expect(data).not.toBeInstanceOf(Blob);
    (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = {
      documents: [{ id: 'foreign-docx', type: DOCX, data, getEditor: () => null }],
    };

    const [exported] = await instance.exportEditorsToDOCX();

    expect(exported).toBe(data);
  });

  it('downloads a cross-realm Blob through the default export path', async () => {
    const instance = createInstance();
    const data = createForeignDocxBlob();
    expect(data).not.toBeInstanceOf(Blob);
    (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = {
      documents: [{ id: 'foreign-docx', type: DOCX, data, getEditor: () => null }],
    };

    const exported = await instance.export({ exportedName: 'foreign-docx' });

    expect(exported).toBeInstanceOf(Blob);
    expect(exported).not.toBe(data);
    expect(exported.type).toBe(DOCX);
    expect(exported.size).toBe(data.size);
  });

  it('rejects a plain object that mimics a DOCX Blob', async () => {
    const instance = createInstance();
    const data = { size: 4, type: DOCX, arrayBuffer: async () => new ArrayBuffer(4) };
    (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = {
      documents: [{ id: 'fake-docx', type: DOCX, data, getEditor: () => null }],
    };

    await expect(instance.exportEditorsToDOCX()).resolves.toEqual([]);
  });

  it.each([
    ['pdf only', ['pdf']],
    ['HTML only', ['html']],
    ['an empty list', []],
    ['mixed supported and unsupported types', ['docx', 'pdf']],
  ])('rejects %s before exporting DOCX', async (_label, exportType) => {
    const instance = createInstance();
    const exportDocx = vi.spyOn(instance, 'exportEditorsToDOCX').mockResolvedValue([createDocxBlob()]);

    await expect(
      instance.export({
        exportType: exportType as unknown as ExportParams['exportType'],
        triggerDownload: false,
      }),
    ).rejects.toThrow('SuperDoc.export() only supports exportType: ["docx"].');
    expect(exportDocx).not.toHaveBeenCalled();
  });

  it('rejects unsupported output before downloading an additional file', async () => {
    const instance = createInstance();
    const exportDocx = vi.spyOn(instance, 'exportEditorsToDOCX').mockResolvedValue([createDocxBlob()]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(
      instance.export({
        exportType: ['pdf'] as unknown as ExportParams['exportType'],
        additionalFiles: [new Blob(['audit'])],
        additionalFileNames: ['audit.json'],
      }),
    ).rejects.toThrow('SuperDoc.export() only supports exportType: ["docx"].');
    expect(exportDocx).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    ['the default export type', undefined],
    ['DOCX', ['docx']],
  ])('keeps %s working', async (_label, exportType) => {
    const instance = createInstance();
    const docx = createDocxBlob();
    const exportDocx = vi.spyOn(instance, 'exportEditorsToDOCX').mockResolvedValue([docx]);

    const result = await instance.export({
      exportType: exportType as unknown as ExportParams['exportType'],
      triggerDownload: false,
    });

    expect(result).toBe(docx);
    expect(exportDocx).toHaveBeenCalledOnce();
  });
});
