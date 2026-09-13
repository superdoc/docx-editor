import { DOCX, PDF, HTML } from '@superdoc/common';
import { readCollaborationConfig } from '../collaboration/resolve-v2-collaboration-target.js';

/**
 * @typedef {Object} UploadWrapper
 * @property {File|Blob} [originFileObj] Underlying file reference used by some uploaders
 * @property {File|Blob} [file] Underlying file reference used by some uploaders
 * @property {File|Blob} [raw] Underlying file reference used by some uploaders
 * @property {string|number} [uid] Optional unique id from uploaders (ignored)
 * @property {string} [name] Display name (not always reliable for the native file)
 */

/**
 * @typedef {Object} DocumentEntry
 * @property {string} [type] Mime type or shorthand ('docx' | 'pdf' | 'html')
 * @property {string} [name] Filename to display
 * @property {File|Blob|ArrayBuffer|Uint8Array|UploadWrapper} [data] Document data
 * @property {string} [url] Remote URL to fetch; left as-is for URL flows
 * @property {boolean} [isNewFile]
 */

/**
 * Extract a File or Blob from common browser upload values.
 *
 * @param {File|Blob|UploadWrapper|any} input File-like object or upload wrapper
 * @param {string} [fallbackName] Name to use when a Blob has none
 * @returns {File|Blob|null}
 */
export const extractBrowserFile = (input, fallbackName = 'document') => {
  if (!input) return null;

  if (typeof File === 'function' && input instanceof File) return input;

  if (typeof Blob === 'function' && input instanceof Blob) {
    const hasFileCtor = typeof File === 'function';
    if (hasFileCtor) {
      const name = input.name || fallbackName;
      return new File([input], name, { type: input.type });
    }
    return input;
  }

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

/**
 * Recognize byte sources across browser realms by checking their internal
 * slots instead of realm-local constructors.
 *
 * @param {unknown} input
 * @returns {input is ArrayBuffer|Uint8Array}
 */
export const isDocumentByteSource = (input) => {
  if (ArrayBuffer.isView(input)) return typedArrayTagGetter?.call(input) === 'Uint8Array';
  if (!arrayBufferByteLengthGetter) return false;

  try {
    arrayBufferByteLengthGetter.call(input);
    return true;
  } catch {
    return false;
  }
};

/**
 * Copy a byte source into this browser realm when needed.
 *
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {Uint8Array}
 */
const documentByteSourceToUint8Array = (input) => {
  if (input instanceof Uint8Array) return input;

  const bytes = ArrayBuffer.isView(input) ? input : new Uint8Array(/** @type {ArrayBuffer} */ (input));
  return Uint8Array.from(/** @type {Uint8Array} */ (bytes));
};

/**
 * Convert a byte source into a Blob from this browser realm.
 *
 * @param {ArrayBuffer|Uint8Array} input
 * @param {string} type
 * @returns {Blob}
 */
export const documentByteSourceToBlob = (input, type) => {
  return new Blob([documentByteSourceToUint8Array(input)], { type });
};

/**
 * Expand supported document type shorthands to MIME types.
 *
 * @param {string} type
 * @returns {string}
 */
const canonicalizeDocumentType = (type) => {
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

/**
 * Infer a MIME type from a filename.
 * @param {string} [name]
 * @returns {string}
 */
const inferTypeFromName = (name = '') => {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.docx')) return DOCX;
  if (lower.endsWith('.pdf')) return PDF;
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return HTML;
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  return '';
};

const getDefaultDocumentName = (type) => {
  if (type === DOCX) return 'document.docx';
  if (type === PDF) return 'document.pdf';
  if (type === HTML) return 'document.html';
  return 'document';
};

const GENERIC_BINARY_MIME = 'application/octet-stream';

/**
 * Normalize a supported document input into a structured source.
 *
 * @param {File|Blob|UploadWrapper|DocumentEntry|any} entry
 * @returns {DocumentEntry|any} A normalized entry, or the original value when it is unsupported or unchanged
 */
export const normalizeDocumentEntry = (entry) => {
  if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'collaboration')) {
    const source = { ...entry };
    delete source.collaboration;
    // The internal document lifecycle uses one field, including upgrade rollback and reopen.
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
  if (maybeFile) {
    const entryName = entry && typeof entry.name === 'string' ? entry.name : '';
    const fileName = /** @type {any} */ (maybeFile).name || '';
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

  if (entry && typeof entry === 'object' && 'data' in entry) {
    if (isDocumentByteSource(entry.data)) {
      const type = canonicalizeDocumentType(entry.type || inferTypeFromName(entry.name) || DOCX);
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
      const type = declaredType || file.type || inferTypeFromName(file.name) || DOCX;
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
        name: entry.name || file.name || 'document',
      };
    }
  }

  if (entry && typeof entry === 'object' && 'url' in entry && typeof entry.type === 'string') {
    const type = canonicalizeDocumentType(entry.type);
    if (type !== entry.type) return { ...entry, type };
  }

  return entry;
};
