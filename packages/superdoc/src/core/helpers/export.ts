const MIME_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  zip: 'application/zip',
  html: 'text/html',
  txt: 'text/plain;charset=utf-8',
  json: 'application/json',
};

const getMimeType = (extension: string): string => {
  if (!extension || typeof extension.toLowerCase !== 'function') return 'application/octet-stream';
  return MIME_TYPES[extension.toLowerCase()] || 'application/octet-stream';
};

const blobSizeGetter =
  typeof Blob === 'function' ? Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get : undefined;

const isBlob = (value: unknown): value is Blob => {
  if (!blobSizeGetter) return false;

  try {
    blobSizeGetter.call(value);
    return true;
  } catch {
    return false;
  }
};

export type DownloadData = Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer> | string;

const ensureBlob = (data: DownloadData, extension: string): Blob => {
  const mimeType = getMimeType(extension);

  if (isBlob(data)) {
    if (data instanceof Blob) return data;
    const crossRealmBlob: Blob = data;
    return new Blob([crossRealmBlob], { type: crossRealmBlob.type || mimeType });
  }

  if (data instanceof ArrayBuffer) {
    return new Blob([data], { type: mimeType });
  }

  if (ArrayBuffer.isView(data)) {
    const { buffer, byteOffset, byteLength } = data;
    const slice = buffer.slice(byteOffset, byteOffset + byteLength);
    return new Blob([slice], { type: mimeType });
  }

  if (typeof data === 'string') {
    return new Blob([data], { type: mimeType });
  }

  if (data == null) {
    throw new TypeError('createDownload requires a Blob, ArrayBuffer, or ArrayBufferView.');
  }

  throw new TypeError(`Cannot create download from value of type ${typeof data}`);
};

export const createDownload = (data: DownloadData, name: string, extension: string): Blob => {
  const blob = ensureBlob(data, extension);

  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return blob;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return blob;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.${extension}`;

  // Some browsers require the link to be in the DOM for the click to trigger.
  const shouldAppend = document.body && typeof document.body.appendChild === 'function';
  if (shouldAppend) document.body.appendChild(a);

  a.click();

  if (shouldAppend) document.body.removeChild(a);

  if (typeof URL.revokeObjectURL === 'function') {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return blob;
};

export const cleanName = (currentName: string): string => {
  const lowerName = currentName.toLowerCase();
  if (lowerName.endsWith('.docx')) {
    return currentName.slice(0, -5);
  }
  if (lowerName.endsWith('.pdf')) {
    return currentName.slice(0, -4);
  }
  return currentName;
};
