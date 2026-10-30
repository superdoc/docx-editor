// @ts-check
import { range } from './helpers/range';

/**
 * @typedef {import('pdfjs-dist').PDFDocumentProxy} PDFDocumentProxy
 * @typedef {import('pdfjs-dist').PDFPageProxy} PDFPageProxy
 */

/**
 * @typedef {'pdfjs'} AdapterType
 */

/**
 * @typedef {Object} PDFConfig
 * @property {AdapterType} adapter
 * @property {any} [pdfLib]
 * @property {string} [workerSrc]
 * @property {boolean} [setWorker]
 */

/**
 * @typedef {Object} PDFJSConfig
 * @property {any} [pdfLib]
 * @property {string} [workerSrc]
 * @property {boolean} [setWorker]
 */

/**
 * @typedef {Object} RenderPagesOptions
 * @property {string} documentId
 * @property {PDFDocumentProxy} pdfDocument
 * @property {HTMLElement} viewerContainer
 * @property {function(string, ...any): void} [emit]
 */

/**
 * @typedef {Object} PageSize
 * @property {number} width
 * @property {number} height
 */

/**
 * @param {Partial<PDFConfig>} [config]
 * @returns {PDFConfig}
 */
export const createPDFConfig = (config) => {
  /** @type {PDFConfig} */
  const defaultConfig = {
    adapter: 'pdfjs',
  };

  return {
    ...defaultConfig,
    ...config,
  };
};

/**
 * @abstract
 */
class PDFAdapter {
  /**
   * @throws {Error}
   */
  constructor() {
    const proto = Object.getPrototypeOf(this);
    if (proto.constructor === PDFAdapter) {
      throw new Error('Abstract class should not be instantiated');
    }
  }
}

export class PDFJSAdapter extends PDFAdapter {
  /**
   * @param {PDFJSConfig} config
   */
  constructor(config) {
    super();

    this.pdfLib = config.pdfLib;
    this.workerSrc = config.workerSrc;

    if (config.setWorker) {
      if (this.workerSrc) {
        this.pdfLib.GlobalWorkerOptions.workerSrc = config.workerSrc;
      } else {
        // Fallback to CDN version.
        this.pdfLib.GlobalWorkerOptions.workerSrc = getWorkerSrcFromCDN(this.pdfLib.version);
      }
    }
  }

  /**
   * @param {string | ArrayBuffer | Uint8Array} file
   * @returns {Promise<PDFDocumentProxy>}
   */
  async getDocument(file) {
    const loadingTask = this.pdfLib.getDocument(file);
    const document = await loadingTask.promise;
    return document;
  }

  /**
   * @param {PDFDocumentProxy} pdf
   * @param {number} firstPage
   * @param {number} lastPage
   * @returns {Promise<PDFPageProxy[]>}
   */
  async getPages(pdf, firstPage, lastPage) {
    const pagesPromises = range(firstPage, lastPage + 1).map((num) => pdf.getPage(num));
    return await Promise.all(pagesPromises);
  }
}

export class PDFAdapterFactory {
  /**
   * @param {PDFConfig} config
   * @returns {PDFJSAdapter}
   * @throws {Error}
   */
  static create(config) {
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

/**
 * @param {number} version
 * @returns {string}
 */
export function getWorkerSrcFromCDN(version) {
  return `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
}
