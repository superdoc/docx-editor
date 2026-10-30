import { describe, expect, it } from 'vite-plus/test';
import * as realPdfJs from 'pdfjs-dist';
import { PDFJSAdapter } from './pdf-adapter.js';

const REQUIRES_PDFJS = 'PDFJSAdapter requires a pdf.js module as pdfLib';

const resolvingLoader = () => ({ promise: Promise.resolve({ numPages: 1 }) });

describe('PDFJSAdapter pdfLib validation', () => {
  it('accepts the installed pdf.js module', () => {
    const adapter = new PDFJSAdapter({ pdfLib: realPdfJs, workerSrc: '/w.js', setWorker: true });

    expect(realPdfJs.GlobalWorkerOptions.workerSrc).toBe('/w.js');
    expect(adapter.pdfLib).toBe(realPdfJs);
  });

  it('loads a document through a wrapper that only provides getDocument', async () => {
    const adapter = new PDFJSAdapter({ pdfLib: { getDocument: resolvingLoader } });

    await expect(adapter.getDocument(new ArrayBuffer(8))).resolves.toEqual({ numPages: 1 });
  });

  it('sets an explicit workerSrc without requiring a version', () => {
    const GlobalWorkerOptions = { workerSrc: '' };
    new PDFJSAdapter({
      pdfLib: { getDocument: resolvingLoader, GlobalWorkerOptions },
      workerSrc: '/w.js',
      setWorker: true,
    });

    expect(GlobalWorkerOptions.workerSrc).toBe('/w.js');
  });

  it.each([
    ['missing', undefined],
    ['without GlobalWorkerOptions', { version: '5.0.0', getDocument: resolvingLoader }],
  ])('throws a named TypeError when setting the worker with a pdfLib %s', (_label, pdfLib) => {
    expect(() => new PDFJSAdapter({ pdfLib, setWorker: true, workerSrc: '/w.js' })).toThrow(
      new TypeError(REQUIRES_PDFJS),
    );
  });

  it('throws a named TypeError when the CDN worker fallback has no string version', () => {
    const pdfLib = { getDocument: resolvingLoader, GlobalWorkerOptions: { workerSrc: '' }, version: 5 };

    expect(() => new PDFJSAdapter({ pdfLib, setWorker: true })).toThrow(new TypeError(REQUIRES_PDFJS));
  });

  it('throws a named TypeError when loading a document without getDocument', async () => {
    const adapter = new PDFJSAdapter({ pdfLib: {} });

    await expect(adapter.getDocument(new ArrayBuffer(8))).rejects.toThrow(new TypeError(REQUIRES_PDFJS));
  });
});
