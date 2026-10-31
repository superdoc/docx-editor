import { DOCX, PDF, HTML } from '@superdoc/common';
import { readCollaborationConfig } from '../collaboration/resolve-v2-collaboration-target.js';
import type { Document, DocumentSource } from '../types/index.js';

export type BrowserFile = File | Blob;

export type DocumentByteSource = ArrayBuffer | Uint8Array;

type EntryFields = {
  originFileObj?: unknown;
  file?: unknown;
  raw?: unknown;
  name?: unknown;
  type?: unknown;
  data?: unknown;
  v2Collaboration?: unknown;
};

const isEntryRecord = (value: unknown): value is EntryFields =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';

const toFileName = (value: unknown): string => `${value}`;

export const extractBrowserFile = (input: unknown, fallbackName: unknown = 'document'): BrowserFile | null => {
  if (!input) return null;

  if (typeof File === 'function' && input instanceof File) return input;

  if (typeof Blob === 'function' && input instanceof Blob) {
    const hasFileCtor = typeof File === 'function';
    if (hasFileCtor) {
      const name = ('name' in input ? input.name : undefined) || fallbackName;
      return new File([input], toFileName(name), { type: input.type });
    }
    return input;
  }

  if (!isEntryRecord(input)) return null;

  if (input.originFileObj) return extractBrowserFile(input.originFileObj, input.name || fallbackName);

  if (input.file) return extractBrowserFile(input.file, input.name || fallbackName);
  if (input.raw) return extractBrowserFile(input.raw, input.name || fallbackName);

  return null;
};

const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)?.get;

export const isDocumentByteSource = (input: unknown): input is DocumentByteSource => {
  if (ArrayBuffer.isView(input)) return typedArrayTagGetter?.call(input) === 'Uint8Array';
  if (!arrayBufferByteLengthGetter) return false;

  try {
    arrayBufferByteLengthGetter.call(input);
    return true;
  } catch {
    return false;
  }
};

const documentByteSourceToUint8Array = (input: DocumentByteSource): Uint8Array => {
  if (input instanceof Uint8Array) return input;

  const view = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input);
  return view.slice();
};

export const documentByteSourceToBlob = (input: DocumentByteSource, type: string): Blob => {
  return new Blob([documentByteSourceToUint8Array(input) as Uint8Array<ArrayBuffer>], { type });
};

const canonicalizeDocumentType = (type: string): string => {
  switch (type.toLowerCase()) {
    case 'docx':
    case DOCX:
      return DOCX;
    case 'pdf':
    case PDF:
      return PDF;
    case 'html':
    case HTML:
      return HTML;
    default:
      return type;
  }
};

const inferTypeFromName = (name: unknown = ''): string => {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.docx')) return DOCX;
  if (lower.endsWith('.pdf')) return PDF;
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return HTML;
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  return '';
};

const getDefaultDocumentName = (type: string): string => {
  if (type === DOCX) return 'document.docx';
  if (type === PDF) return 'document.pdf';
  if (type === HTML) return 'document.html';
  return 'document';
};

const GENERIC_BINARY_MIME = 'application/octet-stream';

export function normalizeDocumentEntry(entry: Exclude<DocumentSource, string>): Document;
export function normalizeDocumentEntry(input: unknown): unknown {
  let entry = input;
  if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'collaboration')) {
    const source: { collaboration?: unknown } = { ...entry };
    delete source.collaboration;
    entry = { ...source, v2Collaboration: readCollaborationConfig(entry) };
  }
  if (isDocumentByteSource(entry)) {
    return {
      type: DOCX,
      data: documentByteSourceToUint8Array(entry),
      name: 'document.docx',
    };
  }

  const maybeFile = extractBrowserFile(entry);
  if (maybeFile && isEntryRecord(entry)) {
    const entryName = typeof entry.name === 'string' ? entry.name : '';
    const fileName = ('name' in maybeFile ? maybeFile.name : undefined) || '';
    const entryType = inferTypeFromName(entryName);
    const inferredType = entryType || inferTypeFromName(fileName);
    const hasGenericType = maybeFile.type.toLowerCase() === GENERIC_BINARY_MIME;
    const name = hasGenericType && entryType ? entryName : fileName || entryName || 'document';
    const type = hasGenericType && inferredType ? inferredType : maybeFile.type || inferredType || DOCX;
    let data = maybeFile;

    if (hasGenericType && inferredType && typeof File === 'function' && maybeFile instanceof File) {
      data = new File([maybeFile], name, { type, lastModified: maybeFile.lastModified });
    } else if (hasGenericType && inferredType && typeof Blob === 'function' && maybeFile instanceof Blob) {
      data = new Blob([maybeFile], { type });
    }

    return {
      ...(entry.v2Collaboration !== undefined ? { v2Collaboration: entry.v2Collaboration } : {}),
      type,
      data,
      name,
    };
  }

  if (isEntryRecord(entry) && typeof entry === 'object' && 'data' in entry) {
    if (isDocumentByteSource(entry.data)) {
      const declaredType = entry.type || inferTypeFromName(entry.name) || DOCX;
      if (typeof declaredType !== 'string') {
        throw new TypeError(`SuperDoc: document type must be a string, received ${typeof declaredType}`);
      }
      const type = canonicalizeDocumentType(declaredType);
      return {
        ...entry,
        type,
        data: type === DOCX ? documentByteSourceToUint8Array(entry.data) : documentByteSourceToBlob(entry.data, type),
        name: entry.name || getDefaultDocumentName(type),
      };
    }

    const file = extractBrowserFile(entry.data, entry.name);
    if (file) {
      const declaredType = typeof entry.type === 'string' && entry.type ? canonicalizeDocumentType(entry.type) : '';
      const fileName = 'name' in file ? file.name : undefined;
      const type = declaredType || file.type || inferTypeFromName(fileName) || DOCX;
      const shouldSetDataType = !file.type || Boolean(declaredType && file.type !== declaredType);
      let data = file;
      if (shouldSetDataType && typeof File === 'function' && file instanceof File) {
        data = new File([file], file.name, { type, lastModified: file.lastModified });
      } else if (shouldSetDataType && typeof Blob === 'function' && file instanceof Blob) {
        data = new Blob([file], { type });
      }
      return {
        ...entry,
        type,
        data,
        name: entry.name || fileName || 'document',
      };
    }
  }

  if (isEntryRecord(entry) && typeof entry === 'object' && 'url' in entry && typeof entry.type === 'string') {
    const type = canonicalizeDocumentType(entry.type);
    if (type !== entry.type) return { ...entry, type };
  }

  return entry;
}
