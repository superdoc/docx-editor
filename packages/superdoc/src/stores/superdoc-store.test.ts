import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { useSuperdocStore } from './superdoc-store.js';
import { DOCX, PDF, HTML, getFileObject } from '@superdoc/common';
import { normalizeDocumentEntry } from '../core/helpers/file.js';

vi.mock('@superdoc/common', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getFileObject: vi.fn(),
  };
});

class BlobMock {
  constructor(blobParts = [], options = {}) {
    this.parts = blobParts;
    this.type = options.type || '';
    this.size = 0;

    for (const part of blobParts) {
      if (typeof part === 'string') {
        this.size += new TextEncoder().encode(part).length;
      } else if (part instanceof ArrayBuffer) {
        this.size += part.byteLength;
      } else if (ArrayBuffer.isView(part)) {
        this.size += part.byteLength;
      } else if (part?.size) {
        this.size += part.size;
      }
    }
  }
}

globalThis.Blob = BlobMock;

globalThis.File = class FileMock extends BlobMock {
  constructor(fileBits, fileName, options = {}) {
    super(fileBits, options);
    this.name = fileName;
    this.lastModified = options.lastModified ?? Date.now();
  }
};

const createTestConfig = (documents = [], overrides = {}) => {
  const { modules = {}, user = {}, users = [], ...rest } = overrides;

  return {
    documents,
    modules: { collaboration: false, ...modules },
    user,
    users,
    ...rest,
  };
};

describe('standalone HTML document viewing', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSuperdocStore();
    getFileObject.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const htmlFile = (name = 'document.html', type = HTML) => new File(['<p>Document</p>'], name, { type });

  it.each([
    ['File', () => htmlFile()],
    ['Blob', () => new Blob(['<p>Document</p>'], { type: HTML })],
    ['empty-MIME .html', () => htmlFile('document.html', '')],
    ['empty-MIME .htm', () => htmlFile('document.htm', '')],
    ['generic-MIME .html', () => htmlFile('document.html', 'application/octet-stream')],
    ['originFileObj wrapper', () => ({ originFileObj: htmlFile() })],
    ['file wrapper', () => ({ file: htmlFile() })],
    ['raw wrapper', () => ({ raw: htmlFile() })],
    [
      'wrapper filename',
      () => ({ name: 'document.html', originFileObj: htmlFile('upload.bin', 'application/octet-stream') }),
    ],
    ['structured File', () => ({ data: htmlFile(), type: 'html' })],
    ['typed bytes', () => ({ data: new Uint8Array([60, 112, 62]), type: 'HtMl' })],
    ['ArrayBuffer', () => ({ data: new ArrayBuffer(3), type: HTML.toUpperCase() })],
    ['URL', () => ({ url: 'https://example.com/document.html', type: 'html' })],
    ['MIME with parameters', () => ({ data: htmlFile('document.html', 'text/html; charset=utf-8') })],
  ])('rejects a standalone HTML %s through the document-init exception', async (_label, source) => {
    const onException = vi.fn();

    await store.init(createTestConfig([normalizeDocumentEntry(source())], { onException }));

    expect(store.documents).toEqual([]);
    expect(getFileObject).not.toHaveBeenCalled();
    expect(onException).toHaveBeenCalledExactlyOnceWith({
      error: expect.objectContaining({
        message: 'SuperDoc: HTML document viewing is not supported. Open a DOCX or PDF document.',
      }),
      stage: 'document-init',
      document: expect.any(Object),
    });
  });

  it('rejects HTML before the legacy collaboration shortcut', async () => {
    const onException = vi.fn();
    await store.init(
      createTestConfig([{ data: htmlFile(), type: HTML }], { modules: { collaboration: {} }, onException }),
    );

    expect(store.documents).toEqual([]);
    expect(onException).toHaveBeenCalledOnce();
  });

  it('keeps DOCX and PDF siblings when an HTML entry is rejected', async () => {
    const onException = vi.fn();
    const docx = { id: 'docx', data: new File(['docx'], 'document.docx', { type: DOCX }), type: DOCX };
    const pdf = { id: 'pdf', data: new File(['pdf'], 'document.pdf', { type: PDF }), type: PDF };

    await store.init(createTestConfig([docx, { data: htmlFile(), type: HTML }, pdf], { onException }));

    expect(store.documents.map(({ id }) => id)).toEqual(['docx', 'pdf']);
    expect(onException).toHaveBeenCalledOnce();
  });

  it('preserves the separate DOCX HTML initialization metadata', async () => {
    const html = '<p>DOCX import content</p>';
    const data = new File(['docx'], 'document.docx', { type: DOCX });

    await store.init(createTestConfig([{ data, type: DOCX }], { html }));

    expect(store.documents[0]).toMatchObject({ type: DOCX, data, html });
  });
});

describe('SuperDoc Store - Blob Support', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSuperdocStore();
  });

  it('uses top-level scalar context only for a single initial document', async () => {
    const document = (id, fieldContext) => ({
      id,
      type: DOCX,
      data: new File(['content'], `${id}.docx`, { type: DOCX }),
      fieldContext,
    });
    await store.init(createTestConfig([document('single')], { fieldContext: { fileName: 'Initial.docx' } }));
    expect(store.documents[0].fieldContext).toEqual({ fileName: 'Initial.docx' });
    await store.init(createTestConfig([document('later')]));
    expect(store.documents[0].fieldContext).toBeUndefined();
  });

  it('keeps explicit scalar contexts separate and leaves a missing multi-document context unavailable', async () => {
    const document = (id, fieldContext) => ({
      id,
      type: DOCX,
      data: new File(['content'], `${id}.docx`, { type: DOCX }),
      fieldContext,
    });
    await store.init(
      createTestConfig(
        [
          document('first', { fileName: 'First.docx' }),
          document('second', { fileName: 'Second.docx' }),
          document('missing'),
        ],
        { fieldContext: { fileName: 'Global.docx' } },
      ),
    );
    expect(store.documents.map((doc) => doc.fieldContext)).toEqual([
      { fileName: 'First.docx' },
      { fileName: 'Second.docx' },
      undefined,
    ]);
  });

  describe('_initializeDocumentData', () => {
    it('should handle File objects', async () => {
      const file = new File(['test content'], 'test.docx', {
        type: DOCX,
      });

      const config = createTestConfig([{ data: file, name: 'test.docx', type: DOCX }]);

      await store.init(config);

      expect(store.documents.length).toBe(1);
    });

    it('should handle Blob objects with name', async () => {
      const blob = new Blob(['test content'], { type: DOCX });

      const config = createTestConfig([{ data: blob, name: 'test.docx', type: DOCX }]);

      await store.init(config);

      expect(store.documents.length).toBe(1);
      const document = store.documents[0];
      expect(document.data).toBeInstanceOf(File);
      expect(document.data.name).toBe('test.docx');
    });

    it('should handle Blob objects without name', async () => {
      const blob = new Blob(['test content'], { type: DOCX });

      const config = createTestConfig([{ data: blob, type: DOCX }]);

      await store.init(config);

      expect(store.documents.length).toBe(1);
      const document = store.documents[0];
      expect(document.data).toBeInstanceOf(File);
      expect(document.data.name).toBe('document.docx');
    });

    it('should generate appropriate file extensions based on type', async () => {
      const testCases = [
        { type: DOCX, expectedName: 'document.docx' },
        { type: PDF, expectedName: 'document.pdf' },
        { type: 'other', expectedName: 'document.bin' },
      ];

      for (const testCase of testCases) {
        const blob = new Blob(['test content'], { type: testCase.type });

        const config = createTestConfig([{ data: blob, type: testCase.type }]);

        await store.init(config);

        const document = store.documents[0];
        expect(document.data.name).toBe(testCase.expectedName);

        store.reset();
      }
    });

    it('should preserve blob type during conversion', async () => {
      const blobType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const blob = new Blob(['test content'], { type: blobType });

      const config = createTestConfig([{ data: blob, name: 'test.docx', type: DOCX }]);

      await store.init(config);

      const document = store.documents[0];
      expect(document.data.type).toBe(blobType);
    });

    it('should use document type if blob type is not available', async () => {
      const blob = new Blob(['test content']);

      const config = createTestConfig([{ data: blob, name: 'test.docx', type: DOCX }]);

      await store.init(config);

      const document = store.documents[0];
      expect(document.data.type).toBe(DOCX);
    });

    it('should handle mixed File and Blob objects', async () => {
      const file = new File(['file content'], 'file.docx', { type: DOCX });
      const blob = new Blob(['blob content'], { type: DOCX });

      const config = createTestConfig([
        { data: file, name: 'file.docx', type: DOCX },
        { data: blob, name: 'blob.docx', type: DOCX },
      ]);

      await store.init(config);

      expect(store.documents.length).toBe(2);

      expect(store.documents[0].data).toBeInstanceOf(File);
      expect(store.documents[0].data.name).toBe('file.docx');

      expect(store.documents[1].data).toBeInstanceOf(File);
      expect(store.documents[1].data.name).toBe('blob.docx');
    });

    it('should handle blob instanceof checks correctly', () => {
      const file = new File(['file content'], 'test.docx');
      const blob = new Blob(['blob content']);

      expect(file instanceof File).toBe(true);
      expect(file instanceof Blob).toBe(true);
      expect(blob instanceof File).toBe(false);
      expect(blob instanceof Blob).toBe(true);

      expect(blob instanceof Blob && !(blob instanceof File)).toBe(true);
      expect(file instanceof Blob && !(file instanceof File)).toBe(false);
    });
  });

  describe('error handling', () => {
    let consoleWarnSpy;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should handle invalid document configuration gracefully', async () => {
      const config = createTestConfig([{/* no data, url, or other valid config */}]);

      await store.init(config);

      expect(store.documents.length).toBe(0);
    });

    it('should notify exception handler when document initialization fails', async () => {
      const handler = vi.fn();
      store.setExceptionHandler(handler);

      const config = createTestConfig([{/* invalid entry */}]);

      await store.init(config);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ stage: 'document-init' });
      expect(handler.mock.calls[0][0].error).toBeInstanceOf(Error);
    });
  });
});

describe('SuperDoc Store - zoom.initial seeding', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSuperdocStore();
  });

  const configWithZoom = (zoom) =>
    createTestConfig([{ data: new File(['x'], 'test.docx', { type: DOCX }), name: 'test.docx', type: DOCX }], {
      zoom,
    });

  it('defaults activeZoom to 100 when zoom.initial is absent', async () => {
    await store.init(configWithZoom(undefined));
    expect(store.activeZoom).toBe(100);
  });

  it('seeds activeZoom from zoom.initial before documents initialize', async () => {
    await store.init(configWithZoom({ initial: 50 }));
    expect(store.activeZoom).toBe(50);
  });

  it('ignores invalid zoom.initial values with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await store.init(configWithZoom({ initial: 0 }));
    expect(store.activeZoom).toBe(100);

    await store.init(configWithZoom({ initial: -25 }));
    expect(store.activeZoom).toBe(100);

    await store.init(configWithZoom({ initial: Number.NaN }));
    expect(store.activeZoom).toBe(100);

    await store.init(configWithZoom({ initial: '75' }));
    expect(store.activeZoom).toBe(100);

    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});

describe('SuperDoc Store - zoom.mode seeding', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSuperdocStore();
  });

  const configWithZoom = (zoom) =>
    createTestConfig([{ data: new File(['x'], 'test.docx', { type: DOCX }), name: 'test.docx', type: DOCX }], {
      zoom,
    });

  it('defaults zoomMode to manual', async () => {
    await store.init(configWithZoom(undefined));
    expect(store.zoomMode).toBe('manual');
  });

  it('seeds zoomMode from zoom.mode', async () => {
    await store.init(configWithZoom({ mode: 'fit-width' }));
    expect(store.zoomMode).toBe('fit-width');
  });

  it('ignores invalid zoom.mode values with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await store.init(configWithZoom({ mode: 'fit-page' }));
    expect(store.zoomMode).toBe('manual');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('starts with null viewport metrics', async () => {
    await store.init(configWithZoom(undefined));
    expect(store.viewportMetrics).toBeNull();
  });
});

describe('SuperDoc Store - measurementUnit seeding', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSuperdocStore();
  });

  const configWithUnit = (measurementUnit) =>
    createTestConfig([{ data: new File(['x'], 'test.docx', { type: DOCX }), name: 'test.docx', type: DOCX }], {
      measurementUnit,
    });

  it('defaults measurementUnit to in when config is absent', async () => {
    await store.init(configWithUnit(undefined));
    expect(store.measurementUnit).toBe('in');
  });

  it('seeds measurementUnit from config', async () => {
    await store.init(configWithUnit('cm'));
    expect(store.measurementUnit).toBe('cm');
  });

  it('ignores invalid measurementUnit values with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await store.init(configWithUnit('meters'));
    expect(store.measurementUnit).toBe('in');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('reset() restores measurementUnit to the default', () => {
    store.measurementUnit = 'cm';
    store.reset();
    expect(store.measurementUnit).toBe('in');
  });

  it('does not leak a prior cm unit into a later default document', async () => {
    await store.init(configWithUnit('cm'));
    expect(store.measurementUnit).toBe('cm');

    await store.init(configWithUnit(undefined));
    expect(store.measurementUnit).toBe('in');
  });
});

describe('opt-in initial load lifetime', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getFileObject.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  it('bounds a stalled download and cannot publish its late response', async () => {
    let release;
    getFileObject.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const store = useSuperdocStore();
    const failures = [];
    await store.init(
      createTestConfig([{ id: 'late', type: DOCX, url: '/late.docx', load: { timeoutMs: 5 } }], {
        onException: (failure) => failures.push(failure),
      }),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].error.code).toBe('DOCUMENT_LOAD_TIMEOUT');
    release(new File(['late'], 'late.docx', { type: DOCX }));
    await Promise.resolve();
    expect(store.documents).toHaveLength(0);
  });
  it('retires a stalled import without activating the timed-out document', async () => {
    const store = useSuperdocStore();
    const failures = [];
    await store.init(
      createTestConfig(
        [{ id: 'import', type: DOCX, data: new File(['doc'], 'doc.docx', { type: DOCX }), load: { timeoutMs: 5 } }],
        { onException: (failure) => failures.push(failure) },
      ),
    );
    const scope = store.documents[0].loadScope;
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(store.documents).toHaveLength(0);
    expect(scope.finish()).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe('DOCUMENT_LOAD_TIMEOUT');
  });
});
