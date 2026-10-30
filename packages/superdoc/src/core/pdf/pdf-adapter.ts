import type * as PdfJs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { range } from './helpers/range';

export type AdapterType = 'pdfjs';

export type PdfJsLib = Pick<typeof PdfJs, 'getDocument' | 'GlobalWorkerOptions' | 'version'>;

export type PdfSource = NonNullable<Parameters<PdfJsLib['getDocument']>[0]>;

export type PDFJSConfig = {
  pdfLib?: object;
  workerSrc?: string;
  setWorker?: boolean;
};

export type PDFConfig = PDFJSConfig & {
  adapter: AdapterType;
};

const isObjectLike = (value: unknown): value is object =>
  (typeof value === 'object' || typeof value === 'function') && value !== null;

const REQUIRES_PDFJS = 'PDFJSAdapter requires a pdf.js module as pdfLib';

const hasDocumentLoader = (value: unknown): value is Pick<PdfJsLib, 'getDocument'> =>
  isObjectLike(value) && 'getDocument' in value && typeof value.getDocument === 'function';

const requireWorkerOptions = (value: unknown): { workerSrc?: unknown } => {
  if (isObjectLike(value) && 'GlobalWorkerOptions' in value && isObjectLike(value.GlobalWorkerOptions)) {
    return value.GlobalWorkerOptions;
  }
  throw new TypeError(REQUIRES_PDFJS);
};

const requireVersion = (value: unknown): string => {
  if (isObjectLike(value) && 'version' in value && typeof value.version === 'string') return value.version;
  throw new TypeError(REQUIRES_PDFJS);
};

export const createPDFConfig = (config?: Partial<PDFConfig>): PDFConfig => {
  const defaultConfig: PDFConfig = {
    adapter: 'pdfjs',
  };

  return {
    ...defaultConfig,
    ...config,
  };
};

abstract class PDFAdapter {
  constructor() {
    const proto = Object.getPrototypeOf(this);
    if (proto.constructor === PDFAdapter) {
      throw new Error('Abstract class should not be instantiated');
    }
  }
}

export class PDFJSAdapter extends PDFAdapter {
  pdfLib: object | undefined;
  workerSrc: string | undefined;

  constructor(config: PDFJSConfig) {
    super();

    this.pdfLib = config.pdfLib;
    this.workerSrc = config.workerSrc;

    if (config.setWorker) {
      const workerOptions = requireWorkerOptions(this.pdfLib);
      workerOptions.workerSrc = this.workerSrc || getWorkerSrcFromCDN(requireVersion(this.pdfLib));
    }
  }

  async getDocument(file: PdfSource): Promise<PDFDocumentProxy> {
    const pdfLib = this.pdfLib;
    if (!hasDocumentLoader(pdfLib)) throw new TypeError(REQUIRES_PDFJS);
    return pdfLib.getDocument(file).promise;
  }

  async getPages(pdf: PDFDocumentProxy, firstPage: number, lastPage: number): Promise<PDFPageProxy[]> {
    const pagesPromises = range(firstPage, lastPage + 1).map((num) => pdf.getPage(num));
    return await Promise.all(pagesPromises);
  }
}

export class PDFAdapterFactory {
  static create(config: PDFConfig): PDFJSAdapter {
    const adapters = {
      pdfjs: () => {
        return new PDFJSAdapter(config);
      },
      default: () => {
        throw new Error('Unsupported adapter');
      },
    };
    const adapter = adapters[config.adapter] ?? adapters.default;
    return adapter();
  }
}

export function getWorkerSrcFromCDN(version: string): string {
  return `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
}
