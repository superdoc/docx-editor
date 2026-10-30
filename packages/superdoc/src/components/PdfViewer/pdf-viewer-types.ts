import type { Raw } from 'vue';
import type { PDFDocumentProxy, PDFPageProxy, TextLayer } from 'pdfjs-dist';

export type PdfViewerLib = {
  TextLayer?: typeof TextLayer;
};

export type PdfViewerConfig = {
  pdfLib?: PdfViewerLib;
  workerSrc?: string;
  setWorker?: boolean;
  textLayer?: boolean;
  outputScale?: number;
};

export type PdfViewerDocumentData = {
  documentId: string;
  pdfjsDocument: Raw<PDFDocumentProxy>;
};

export type PdfViewerPageData = {
  documentId: string;
  pageId: string;
  pageNumber: number;
  pageIsRendered: boolean;
  pdfjsPage: Raw<PDFPageProxy>;
};

export type PdfPageRenderedPayload = {
  page: PdfViewerPageData;
  documentId: string;
  pageIndex: number;
  pageNumber: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
};

export type PdfSelectionBounds = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

export type PdfSelectionRawPayload = {
  selectionBounds: PdfSelectionBounds;
  documentId: string;
  page: number;
  source: 'pdf';
};
