import { describe, it, expect, vi } from 'vite-plus/test';
import { createPDFConfig, PDFJSAdapter, PDFAdapterFactory, getWorkerSrcFromCDN } from './pdf-adapter.js';

const makePdfLib = () => ({
  version: '4.0.0',
  GlobalWorkerOptions: { workerSrc: null },
  getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 3 }) })),
});

describe('createPDFConfig', () => {
  it('returns defaults when called without args', () => {
    expect(createPDFConfig()).toEqual({ adapter: 'pdfjs' });
  });

  it('merges overrides onto defaults', () => {
    const cfg = createPDFConfig({ workerSrc: '/worker.js', setWorker: true });
    expect(cfg.adapter).toBe('pdfjs');
    expect(cfg.workerSrc).toBe('/worker.js');
    expect(cfg.setWorker).toBe(true);
  });

  it('allows adapter to be overridden', () => {
    const cfg = createPDFConfig({ adapter: 'pdfjs', pdfLib: {} });
    expect(cfg.adapter).toBe('pdfjs');
  });
});

describe('getWorkerSrcFromCDN', () => {
  it('builds a cdnjs URL for the given version', () => {
    expect(getWorkerSrcFromCDN('3.11.174')).toBe(
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.mjs',
    );
  });
});

describe('PDFJSAdapter', () => {
  it('stores pdfLib and workerSrc from config', () => {
    const pdfLib = makePdfLib();
    const adapter = new PDFJSAdapter({ pdfLib, workerSrc: '/w.js' });
    expect(adapter.pdfLib).toBe(pdfLib);
    expect(adapter.workerSrc).toBe('/w.js');
  });

  it('sets GlobalWorkerOptions.workerSrc when setWorker + workerSrc provided', () => {
    const pdfLib = makePdfLib();
    new PDFJSAdapter({ pdfLib, workerSrc: '/w.js', setWorker: true });
    expect(pdfLib.GlobalWorkerOptions.workerSrc).toBe('/w.js');
  });

  it('falls back to CDN worker when setWorker is true and no workerSrc', () => {
    const pdfLib = makePdfLib();
    new PDFJSAdapter({ pdfLib, setWorker: true });
    expect(pdfLib.GlobalWorkerOptions.workerSrc).toContain('cdnjs.cloudflare.com');
    expect(pdfLib.GlobalWorkerOptions.workerSrc).toContain('4.0.0');
  });

  it('does not touch GlobalWorkerOptions when setWorker is false', () => {
    const pdfLib = makePdfLib();
    new PDFJSAdapter({ pdfLib, workerSrc: '/w.js', setWorker: false });
    expect(pdfLib.GlobalWorkerOptions.workerSrc).toBeNull();
  });

  it('getDocument resolves to the pdf proxy', async () => {
    const pdfLib = makePdfLib();
    const adapter = new PDFJSAdapter({ pdfLib });
    const doc = await adapter.getDocument('/file.pdf');
    expect(doc).toEqual({ numPages: 3 });
    expect(pdfLib.getDocument).toHaveBeenCalledWith('/file.pdf');
  });

  it('getPages resolves pages for an inclusive range', async () => {
    const pdfLib = makePdfLib();
    const pdf = {
      getPage: vi.fn((n) => Promise.resolve({ pageNumber: n })),
    };
    const adapter = new PDFJSAdapter({ pdfLib });
    const pages = await adapter.getPages(pdf, 1, 3);
    expect(pages).toEqual([{ pageNumber: 1 }, { pageNumber: 2 }, { pageNumber: 3 }]);
    expect(pdf.getPage).toHaveBeenCalledTimes(3);
  });
});

describe('PDFAdapterFactory', () => {
  it('creates a PDFJSAdapter for adapter: "pdfjs"', () => {
    const adapter = PDFAdapterFactory.create({ adapter: 'pdfjs', pdfLib: makePdfLib() });
    expect(adapter).toBeInstanceOf(PDFJSAdapter);
  });

  it('throws for unsupported adapter types', () => {
    expect(() => PDFAdapterFactory.create({ adapter: 'unknown', pdfLib: makePdfLib() })).toThrow(/Unsupported adapter/);
  });
});
