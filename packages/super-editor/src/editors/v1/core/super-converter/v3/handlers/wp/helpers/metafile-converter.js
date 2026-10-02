/**
 * EMF/WMF to browser-renderable image converter.
 *
 * Converts Windows Enhanced Metafile (EMF/EMF+) and Windows Metafile (WMF) images
 * into a format browsers can render, returned as a data URI plus short format tag.
 * Strategy, in order of preference:
 *   1. Embedded bitmap fast paths (no rasterization required):
 *      - Classic EMR_STRETCHDIBITS DIB → BMP
 *      - EmfPlusObject(Image) compressed bitmap → original PNG/JPEG/GIF
 *   2. Raw-pixel EmfPlusObject(Image) → PNG via canvas
 *   3. Complete classic drawing via the rtf.js renderer → SVG (including EMF+ Dual Unicode text compositions)
 *   4. Placeholder SVG when an EMF+ payload uses GDI+ vector records we can't render
 *
 * EMF/WMF rendering code extracted from rtf.js (MIT License)
 * Original: https://github.com/nicktf/rtf.js
 * Copyright (c) 2016 Tom Zoehner, Copyright (c) 2018 Thomas Bluemel
 *
 * @module metafile-converter
 */

/* global btoa, XMLSerializer */

import { EMFJS, WMFJS } from './rtfjs';
import { dataUriToArrayBuffer } from '../../../../helpers.js';

// Disable verbose logging from the renderers
EMFJS.loggingEnabled(false);
WMFJS.loggingEnabled(false);

// Optional DOM environment provided by callers (e.g., JSDOM in Node)
let domEnvironment = null;

/**
 * Configure a DOM environment that can be used when running in Node.
 *
 * @param {{ mockWindow?: Window|null, window?: Window|null, mockDocument?: Document|null, document?: Document|null }|null} env
 */
export const setMetafileDomEnvironment = (env) => {
  domEnvironment = env || null;
};

/**
 * Ensure required DOM globals exist. Returns true if a usable DOM is present.
 */
function ensureDomEnvironment() {
  // Already present
  const hasDom = typeof document !== 'undefined' && typeof XMLSerializer !== 'undefined';
  if (hasDom) return true;

  const env = domEnvironment || {};
  const win = env.window || env.mockWindow || null;
  const doc = env.document || env.mockDocument || win?.document || null;

  if (win && doc) {
    if (typeof globalThis.window === 'undefined') globalThis.window = win;
    if (typeof globalThis.document === 'undefined') globalThis.document = doc;
    if (win.XMLSerializer && typeof globalThis.XMLSerializer === 'undefined') {
      globalThis.XMLSerializer = win.XMLSerializer;
    }
    if (win.Node && typeof globalThis.Node === 'undefined') {
      globalThis.Node = win.Node;
    }
    if (typeof globalThis.atob === 'undefined' && typeof win.atob === 'function') {
      globalThis.atob = win.atob.bind(win);
    }
    if (typeof globalThis.btoa === 'undefined' && typeof win.btoa === 'function') {
      globalThis.btoa = win.btoa.bind(win);
    }
  }

  return typeof document !== 'undefined' && typeof XMLSerializer !== 'undefined';
}

/**
 * Default map mode for metafile rendering.
 * MM_ANISOTROPIC (8) allows independent scaling of x and y axes.
 */
const MM_ANISOTROPIC = 8;

const EMF_SIGNATURE = 0x464d4520; // ' EMF'
const EMF_PLUS_SIGNATURE = 0x2b464d45; // 'EMF+' inside EMR_COMMENT

// Classic EMR record type for comments (MS-EMF § 2.3.3.1)
const EMR_COMMENT = 70;

// EMF+ record types (MS-EMFPLUS § 2.1.1.1)
const EMF_PLUS_OBJECT = 0x4008;

// EMF+ object types encoded in EmfPlusObject Flags bits 8–14 (MS-EMFPLUS § 2.1.1.21)
const EMF_PLUS_OBJECT_TYPE_IMAGE = 5;

// EmfPlusImage Type field (MS-EMFPLUS § 2.2.1.4)
const EMF_PLUS_IMAGE_TYPE_BITMAP = 1;

// EmfPlusBitmap Type field (MS-EMFPLUS § 2.2.2.2)
const EMF_PLUS_BITMAP_TYPE_PIXEL = 0;
const EMF_PLUS_BITMAP_TYPE_COMPRESSED = 1;

// EmfPlusPixelFormat enumeration (MS-EMFPLUS § 2.1.1.25). The high byte of the
// low word holds format flags; PixelFormatIndexed (0x00010000) signals palette use.
const EMF_PLUS_PIXEL_FORMAT_INDEXED_FLAG = 0x00010000;
const EMF_PLUS_PIXEL_FORMAT_24BPP_RGB = 0x00021808;
const EMF_PLUS_PIXEL_FORMAT_32BPP_RGB = 0x00022009;
const EMF_PLUS_PIXEL_FORMAT_32BPP_ARGB = 0x0026200a;
const EMF_PLUS_PIXEL_FORMAT_32BPP_PARGB = 0x000e200b;

// Cap canvas allocations so a malformed/oversized bitmap can't exhaust memory.
// 100M pixels ≈ 400 MB of RGBA — well above any realistic document image.
const MAX_PIXEL_BITMAP_PIXELS = 100_000_000;

// Re-export for local use — shared implementation lives in ../../../../helpers.js
const base64ToArrayBuffer = dataUriToArrayBuffer;

/**
 * Encodes a Uint8Array into base64 using chunked processing to avoid call stack overflows.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function uint8ToBase64(bytes) {
  const chunkSize = 0x8000; // 32KB chunks to avoid exceeding the argument limit
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binary);
}

/**
 * Detect a compressed image format (PNG/JPEG/GIF) from its leading bytes and return
 * the matching MIME type and short extension.
 *
 * @param {Uint8Array} bytes
 * @returns {{ mime: string, format: string } | null}
 */
function detectCompressedImageFormat(bytes) {
  if (!bytes || bytes.length < 4) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: 'image/png', format: 'png' };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', format: 'jpeg' };
  }

  // GIF: 'GIF8'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { mime: 'image/gif', format: 'gif' };
  }

  return null;
}

/**
 * Concatenate a list of Uint8Arrays into a single Uint8Array.
 *
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
function concatBytes(parts) {
  let totalLength = 0;
  for (const part of parts) totalLength += part.byteLength;

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

/**
 * Resolve an HTMLCanvasElement from the active DOM environment, preferring the one
 * provided via setMetafileDomEnvironment so callers running in Node with node-canvas
 * (or similar) aren't bypassed by a partial global document. Mirrors tiff-converter.
 *
 * @returns {HTMLCanvasElement|null}
 */
function createCanvasFromEnv() {
  const env = domEnvironment || {};
  const doc = env.document || env.mockDocument || env.window?.document || env.mockWindow?.document || null;
  if (doc) {
    return doc.createElement('canvas');
  }
  if (typeof document !== 'undefined') {
    return document.createElement('canvas');
  }
  return null;
}

/**
 * Convert a row of EMF+ pixel data into Canvas RGBA bytes.
 * EMF+ stores 24/32bpp pixels as little-endian DWORDs, which read byte-by-byte
 * gives B, G, R (and A for 32bpp formats) — the reverse of Canvas ImageData order.
 *
 * 32bppPARGB carries premultiplied alpha; Canvas ImageData expects straight alpha,
 * so divide each channel by alpha/255 to recover the original color.
 *
 * @param {Uint8Array} src - row of pixel data
 * @param {number} srcOffset - byte offset of the row within src
 * @param {Uint8ClampedArray} dst - destination RGBA buffer
 * @param {number} dstOffset - byte offset in dst
 * @param {number} width
 * @param {number} pixelFormat - one of the EMF_PLUS_PIXEL_FORMAT_* constants
 * @returns {boolean} true on success, false on bounds violation
 */
function convertEmfPlusPixelRow(src, srcOffset, dst, dstOffset, width, pixelFormat) {
  const bytesPerPixel = pixelFormat === EMF_PLUS_PIXEL_FORMAT_24BPP_RGB ? 3 : 4;
  if (srcOffset + width * bytesPerPixel > src.byteLength) return false;

  let s = srcOffset;
  let d = dstOffset;
  for (let x = 0; x < width; x++) {
    const b = src[s];
    const g = src[s + 1];
    const r = src[s + 2];

    if (pixelFormat === EMF_PLUS_PIXEL_FORMAT_24BPP_RGB) {
      dst[d] = r;
      dst[d + 1] = g;
      dst[d + 2] = b;
      dst[d + 3] = 255;
      s += 3;
    } else if (pixelFormat === EMF_PLUS_PIXEL_FORMAT_32BPP_PARGB) {
      const a = src[s + 3];
      if (a === 0) {
        dst[d] = 0;
        dst[d + 1] = 0;
        dst[d + 2] = 0;
        dst[d + 3] = 0;
      } else {
        const scale = 255 / a;
        dst[d] = r * scale;
        dst[d + 1] = g * scale;
        dst[d + 2] = b * scale;
        dst[d + 3] = a;
      }
      s += 4;
    } else {
      // 32bppARGB or 32bppRGB
      dst[d] = r;
      dst[d + 1] = g;
      dst[d + 2] = b;
      dst[d + 3] = pixelFormat === EMF_PLUS_PIXEL_FORMAT_32BPP_ARGB ? src[s + 3] : 255;
      s += 4;
    }
    d += 4;
  }
  return true;
}

/**
 * Render a raw-pixel EmfPlusBitmap onto a canvas and return it as a PNG data URI.
 * Returns null when the pixel format is unsupported, the dimensions are out of
 * bounds, or no canvas is available (e.g. Node without node-canvas).
 *
 * Row order: MS-EMFPLUS § 2.2.2.2 is silent on what Height/Stride sign means for
 * storage direction. Empirically, GDI+ (the producer for every Office-generated
 * EMF+) lays out pixel memory top-down regardless of Height sign — its Bitmap
 * class stores row 0 at Scan0 and walks down by +Stride. The classic Windows DIB
 * convention (positive Height = bottom-up) does not carry over to EMF+. Treat
 * storage row 0 as the visual top in all cases.
 * Stride may be negative; |stride| is the row span in bytes.
 *
 * @param {{ width: number, height: number, stride: number, pixelFormat: number, pixels: Uint8Array }} bitmap
 * @returns {{ dataUri: string, format: string } | null}
 */
function renderEmfPlusPixelBitmap({ width, height, stride, pixelFormat, pixels }) {
  if (width <= 0 || height === 0) return null;
  const absHeight = Math.abs(height);
  const absStride = Math.abs(stride);
  if (absStride === 0) return null;
  if (width * absHeight > MAX_PIXEL_BITMAP_PIXELS) return null;

  if ((pixelFormat & EMF_PLUS_PIXEL_FORMAT_INDEXED_FLAG) !== 0) return null;
  if (
    pixelFormat !== EMF_PLUS_PIXEL_FORMAT_24BPP_RGB &&
    pixelFormat !== EMF_PLUS_PIXEL_FORMAT_32BPP_RGB &&
    pixelFormat !== EMF_PLUS_PIXEL_FORMAT_32BPP_ARGB &&
    pixelFormat !== EMF_PLUS_PIXEL_FORMAT_32BPP_PARGB
  ) {
    return null;
  }

  if (absStride * absHeight > pixels.byteLength) return null;

  const rgba = new Uint8ClampedArray(width * absHeight * 4);
  for (let y = 0; y < absHeight; y++) {
    if (!convertEmfPlusPixelRow(pixels, y * absStride, rgba, y * width * 4, width, pixelFormat)) {
      return null;
    }
  }

  const canvas = createCanvasFromEnv();
  if (!canvas) return null;
  canvas.width = width;
  canvas.height = absHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imageData = ctx.createImageData(width, absHeight);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);

  const dataUri = canvas.toDataURL('image/png');
  if (!dataUri || dataUri === 'data:,') return null;
  return { dataUri, format: 'png' };
}

/**
 * Parse the body of an EmfPlusObject(Image) record and return it as a data URI.
 * Compressed bitmaps (PNG/JPEG/GIF) are extracted verbatim; raw-pixel bitmaps are
 * rendered onto a canvas and exported as PNG. Metafile-typed images are rejected
 * because they would require a full GDI+ rasterizer.
 *
 * Layout (MS-EMFPLUS § 2.2.1.4 EmfPlusImage + § 2.2.2.2 EmfPlusBitmap):
 *   0:  Version          (4 bytes, ignored)
 *   4:  Type             (4 bytes) — 1 = Bitmap, 2 = Metafile
 *   For Bitmap:
 *     8:  Width          (4 bytes, signed)
 *     12: Height         (4 bytes, signed — see renderEmfPlusPixelBitmap for row order)
 *     16: Stride         (4 bytes, signed)
 *     20: PixelFormat    (4 bytes)
 *     24: Type           (4 bytes) — 0 = Pixel, 1 = Compressed
 *     28: BitmapData     — encoded PNG/JPEG/GIF when Compressed, raw pixels when Pixel
 *
 * @param {Uint8Array} bytes - EmfPlusImage object data
 * @returns {{ dataUri: string, format: string } | null}
 */
function parseEmfPlusImageObject(bytes) {
  if (!bytes || bytes.byteLength < 28) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const imageType = view.getUint32(4, true);
  if (imageType !== EMF_PLUS_IMAGE_TYPE_BITMAP) return null;

  const bitmapType = view.getUint32(24, true);

  if (bitmapType === EMF_PLUS_BITMAP_TYPE_COMPRESSED) {
    const compressed = bytes.subarray(28);
    const formatInfo = detectCompressedImageFormat(compressed);
    if (!formatInfo) return null;

    return {
      dataUri: `data:${formatInfo.mime};base64,${uint8ToBase64(compressed)}`,
      format: formatInfo.format,
    };
  }

  if (bitmapType === EMF_PLUS_BITMAP_TYPE_PIXEL) {
    return renderEmfPlusPixelBitmap({
      width: view.getInt32(8, true),
      height: view.getInt32(12, true),
      stride: view.getInt32(16, true),
      pixelFormat: view.getUint32(20, true),
      pixels: bytes.subarray(28),
    });
  }

  return null;
}

/**
 * Some EMF files (notably PowerPoint cover slides and Office charts) carry their visual
 * payload as a bitmap embedded inside an EmfPlusObject(Image) record rather than as
 * classic GDI records. Extract and decode that bitmap — compressed PNG/JPEG/GIF are
 * returned verbatim; raw pixels are rendered onto a canvas — so the image can render
 * without a full GDI+ renderer.
 *
 * Walks the outer EMF stream looking for EMR_COMMENT records carrying EMF+ data, then
 * walks the inner EMF+ records for EmfPlusObject(Image) entries. Continued objects
 * (Flags.ContinueBit set) are reassembled by ObjectId. Per MS-EMFPLUS § 2.3.5.1:
 *   - When ContinueBit=1, the record header is 16 bytes and includes a TotalObjectSize
 *     field at offset 8 between Size and DataSize. ObjectData starts at offset 16.
 *   - When ContinueBit=0, the record header is the standard 12 bytes. ObjectData
 *     starts at offset 12, and this record is either standalone or the final chunk
 *     of a continuation series (in which case the buffered chunks are reassembled).
 *
 * @param {ArrayBuffer} buffer
 * @returns {{ dataUri: string, format: string } | null}
 */
function extractBitmapFromEmfPlus(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 108) return null;

  const type = view.getUint32(0, true);
  const headerSize = view.getUint32(4, true);
  const signature = view.getUint32(40, true);
  if (type !== 1 || signature !== EMF_SIGNATURE) return null;
  if (headerSize <= 0 || headerSize >= view.byteLength) return null;

  const pendingByObjectId = new Map();

  let offset = headerSize;
  while (offset + 8 <= view.byteLength) {
    const recordType = view.getUint32(offset, true);
    const recordSize = view.getUint32(offset + 4, true);
    if (recordSize < 8 || offset + recordSize > view.byteLength) break;

    if (recordType === EMR_COMMENT && recordSize >= 20) {
      const dataSize = view.getUint32(offset + 8, true);
      // EMR_COMMENT layout: Type (4) | Size (4) | DataSize (4) | Data (DataSize bytes).
      // The CommentIdentifier is the first 4 bytes of Data; EMF+ records follow it.
      if (dataSize >= 4 && dataSize <= recordSize - 12) {
        const identifier = view.getUint32(offset + 12, true);
        if (identifier === EMF_PLUS_SIGNATURE) {
          const emfPlusStart = offset + 16;
          const emfPlusEnd = offset + 12 + dataSize;

          let pos = emfPlusStart;
          while (pos + 12 <= emfPlusEnd) {
            const epType = view.getUint16(pos, true);
            const epFlags = view.getUint16(pos + 2, true);
            const epSize = view.getUint32(pos + 4, true);
            if (epSize < 12 || pos + epSize > emfPlusEnd) break;

            if (epType === EMF_PLUS_OBJECT) {
              const objectId = epFlags & 0x00ff;
              const objectType = (epFlags >> 8) & 0x7f;
              const continueBit = (epFlags & 0x8000) !== 0;

              // ContinueBit=1: Type(2) Flags(2) Size(4) TotalObjectSize(4) DataSize(4) ObjectData
              // ContinueBit=0: Type(2) Flags(2) Size(4)                    DataSize(4) ObjectData
              const headerBytes = continueBit ? 16 : 12;
              if (epSize < headerBytes) break;
              const totalObjectSize = continueBit ? view.getUint32(pos + 8, true) : 0;
              const dataSize = view.getUint32(pos + (continueBit ? 12 : 8), true);
              const dataStart = pos + headerBytes;
              if (dataSize > epSize - headerBytes || dataStart + dataSize > emfPlusEnd) break;

              if (objectType === EMF_PLUS_OBJECT_TYPE_IMAGE) {
                let result = null;

                if (continueBit) {
                  let entry = pendingByObjectId.get(objectId);
                  if (!entry) {
                    entry = { totalSize: totalObjectSize, parts: [], collected: 0 };
                    pendingByObjectId.set(objectId, entry);
                  } else if (entry.totalSize === 0 && totalObjectSize > 0) {
                    entry.totalSize = totalObjectSize;
                  }
                  const chunk = new Uint8Array(buffer, dataStart, dataSize);
                  entry.parts.push(chunk);
                  entry.collected += chunk.byteLength;

                  // The strict spec terminates the series with a ContinueBit=0 record,
                  // but flush early once TotalObjectSize is satisfied so an off-spec
                  // encoder that leaves ContinueBit=1 on the final record still resolves.
                  // Slice to totalSize so a writer that overshoots its declared size
                  // doesn't tack trailing bytes onto the data URI.
                  if (entry.totalSize > 0 && entry.collected >= entry.totalSize) {
                    result = parseEmfPlusImageObject(concatBytes(entry.parts).subarray(0, entry.totalSize));
                    pendingByObjectId.delete(objectId);
                  }
                } else {
                  const pending = pendingByObjectId.get(objectId);
                  if (pending) {
                    pending.parts.push(new Uint8Array(buffer, dataStart, dataSize));
                    const combined = concatBytes(pending.parts);
                    const trimmed = pending.totalSize > 0 ? combined.subarray(0, pending.totalSize) : combined;
                    result = parseEmfPlusImageObject(trimmed);
                    pendingByObjectId.delete(objectId);
                  } else {
                    result = parseEmfPlusImageObject(new Uint8Array(buffer, dataStart, dataSize));
                  }
                }

                if (result) return result;
              }
            }

            pos += epSize;
          }
        }
      }
    }

    offset += recordSize;
  }

  return null;
}

/**
 * Some EMF files generated by Office contain a single STRETCHDIBITS record with an embedded bitmap.
 * rtf.js does not render this record, which results in an empty SVG. This helper extracts the bitmap
 * payload and wraps it in a BMP data URI so the image can still be rendered in the editor.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{ dataUri: string, format: string } | null}
 */
function extractBitmapFromEmf(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 120) return null;

  const type = view.getUint32(0, true);
  const headerSize = view.getUint32(4, true);
  if (type !== 0x00000001 || headerSize <= 0 || headerSize + 80 > view.byteLength) return null;

  const recordOffset = headerSize;
  const recordType = view.getUint32(recordOffset, true);
  // EMR_STRETCHDIBITS = 0x51 (81)
  if (recordType !== 0x00000051) return null;

  const recordSize = view.getUint32(recordOffset + 4, true);
  if (recordOffset + recordSize > view.byteLength) return null;

  const offBmi = view.getUint32(recordOffset + 48, true);
  const cbBmi = view.getUint32(recordOffset + 52, true);
  const offBits = view.getUint32(recordOffset + 56, true);
  const cbBits = view.getUint32(recordOffset + 60, true);

  if (!cbBmi || !cbBits) return null;
  const bmiStart = recordOffset + offBmi;
  const bitsStart = recordOffset + offBits;
  if (bitsStart + cbBits > view.byteLength || bmiStart + cbBmi > view.byteLength) return null;

  // Construct a BMP: 14-byte file header + DIB header + bitmap data.
  const bmpSize = 14 + cbBmi + cbBits;
  const bmpBytes = new Uint8Array(bmpSize);
  const bmpView = new DataView(bmpBytes.buffer);
  // Signature 'BM'
  bmpView.setUint8(0, 0x42);
  bmpView.setUint8(1, 0x4d);
  bmpView.setUint32(2, bmpSize, true); // file size
  bmpView.setUint32(10, 14 + cbBmi, true); // pixel data offset

  bmpBytes.set(new Uint8Array(buffer, bmiStart, cbBmi), 14);
  bmpBytes.set(new Uint8Array(buffer, bitsStart, cbBits), 14 + cbBmi);

  return { dataUri: `data:image/bmp;base64,${uint8ToBase64(bmpBytes)}`, format: 'bmp' };
}

/**
 * Converts an SVG element to a base64 data URI string.
 *
 * @param {SVGElement} svgElement - The SVG element to convert
 * @returns {string} Base64 data URI containing the SVG
 */
function svgToDataUri(svgElement) {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);
  // Use base64 encoding to be compatible with image processing code that expects base64 data URIs
  const base64 = btoa(unescape(encodeURIComponent(svgString)));
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Extracts dimensions from EMF file header.
 *
 * EMF files contain frame bounds in the header that define the image dimensions.
 * The frame is specified in 0.01mm units and needs to be converted to pixels.
 *
 * @param {ArrayBuffer} buffer - The EMF file data
 * @returns {{ width: number, height: number, xExt: number, yExt: number }} Dimensions and extents
 */
function getEmfDimensions(buffer) {
  const view = new DataView(buffer);

  // EMF header structure:
  // Offset 0: type (4 bytes) - should be 1
  // Offset 4: size (4 bytes) - header size
  // Offset 8: bounds (16 bytes) - bounding rectangle in device units
  // Offset 24: frame (16 bytes) - frame rectangle in 0.01mm units

  // Read frame rectangle (in 0.01mm units)
  const frameLeft = view.getInt32(24, true);
  const frameTop = view.getInt32(28, true);
  const frameRight = view.getInt32(32, true);
  const frameBottom = view.getInt32(36, true);

  // Calculate dimensions in 0.01mm units
  const frameWidth = frameRight - frameLeft;
  const frameHeight = frameBottom - frameTop;

  // Convert to pixels (assuming 96 DPI)
  // 1 inch = 25.4mm = 2540 * 0.01mm
  // pixels = (0.01mm units) * 96 / 2540
  const DPI = 96;
  const width = Math.round((frameWidth * DPI) / 2540);
  const height = Math.round((frameHeight * DPI) / 2540);

  // Read device size from header for viewport extents
  // Offset 72: szlDevice (8 bytes) - device size in pixels
  const deviceWidth = view.getInt32(72, true);
  const deviceHeight = view.getInt32(76, true);

  // Use frame dimensions for viewBox extents
  return {
    width: width || 800,
    height: height || 600,
    xExt: frameWidth || deviceWidth || 800,
    yExt: frameHeight || deviceHeight || 600,
    wExt: frameWidth || deviceWidth || 800,
    hExt: frameHeight || deviceHeight || 600,
  };
}

/** Dual drawings with classic Unicode text need the composition, not one bitmap object. */
function hasEmfPlusDualText(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 88) return false;
  let dual = false;
  let text = false;
  let offset = view.getUint32(4, true);
  while (offset >= 88 && offset + 8 <= view.byteLength) {
    const type = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    if (size < 8 || offset + size > view.byteLength) return false;
    if (type === EMR_COMMENT && size >= 28 && view.getUint32(offset + 12, true) === EMF_PLUS_SIGNATURE) {
      const end = Math.min(offset + size, offset + 12 + view.getUint32(offset + 8, true));
      for (let plus = offset + 16; plus + 12 <= end; ) {
        const plusType = view.getUint16(plus, true);
        const plusSize = view.getUint32(plus + 4, true);
        if (plusSize < 12 || plus + plusSize > end) return false;
        if (plusType === 0x4001) dual = (view.getUint16(plus + 2, true) & 1) !== 0;
        plus += plusSize;
      }
    }
    if (type === 84) text = true;
    if (type === 14) break;
    offset += size;
  }
  return dual && text;
}

/**
 * Detect if an EMF file contains EMF+ payloads.
 * EMF+ lives inside EMR_COMMENT records with identifier 0x2B464D45.
 *
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
function isEmfPlus(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 108) return false;

  const type = view.getUint32(0, true);
  const headerSize = view.getUint32(4, true);
  const signature = view.getUint32(40, true);

  if (type !== 1 || signature !== EMF_SIGNATURE || headerSize <= 0 || headerSize >= view.byteLength) return false;

  let offset = headerSize;
  // Scan only a handful of records to avoid heavy work; EMF+ appears early.
  for (let i = 0; i < 10; i++) {
    if (offset + 8 > view.byteLength) break;
    const recordType = view.getUint32(offset, true);
    const recordSize = view.getUint32(offset + 4, true);
    if (recordSize < 8 || offset + recordSize > view.byteLength) break;

    if (recordType === EMR_COMMENT && recordSize >= 20) {
      // EMR_COMMENT layout: Type (4) | Size (4) | DataSize (4) | CommentIdentifier (4) | Data...
      const identifier = view.getUint32(offset + 12, true);
      if (identifier === EMF_PLUS_SIGNATURE) return true;
    }

    offset += recordSize;
  }

  return false;
}

/**
 * Detect if a buffer starts with an EMF header (even if the extension is .wmf).
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
function isEmfHeader(buffer) {
  if (buffer.byteLength < 48) return false;
  const view = new DataView(buffer);
  const type = view.getUint32(0, true);
  const signature = view.getUint32(40, true);
  return type === 1 && signature === EMF_SIGNATURE;
}

/**
 * Create a simple placeholder SVG at the requested size.
 * @param {{ width?: number, height?: number, label: string }} params
 * @returns {{ dataUri: string, format: string }}
 */
function createPlaceholder(params) {
  const width = Math.max(1, Math.round(params.width || 400));
  const height = Math.max(1, Math.round(params.height || 300));
  const label = params.label || 'Unable to render image';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><rect width="100%" height="100%" fill="#ffffff" stroke="#d9d9d9" stroke-width="1"/><text x="50%" y="50%" fill="#595959" font-family="sans-serif" font-size="${Math.max(
    8,
    Math.min(12, Math.floor(width / 30)),
  )}" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  const base64 = btoa(unescape(encodeURIComponent(svg)));
  return { dataUri: `data:image/svg+xml;base64,${base64}`, format: 'svg' };
}

/**
 * Extracts dimensions from WMF file header.
 *
 * @param {ArrayBuffer} buffer - The WMF file data
 * @returns {{ width: number, height: number, xExt: number, yExt: number }} Dimensions and extents
 */
function getWmfDimensions(buffer) {
  const view = new DataView(buffer);

  // Check for placeable WMF header (starts with magic number 0x9AC6CDD7)
  const magic = view.getUint32(0, true);

  if (magic === 0x9ac6cdd7) {
    // Placeable WMF - read bounding box
    // Offset 6: left (2 bytes)
    // Offset 8: top (2 bytes)
    // Offset 10: right (2 bytes)
    // Offset 12: bottom (2 bytes)
    // Offset 14: unitsPerInch (2 bytes)
    const left = view.getInt16(6, true);
    const top = view.getInt16(8, true);
    const right = view.getInt16(10, true);
    const bottom = view.getInt16(12, true);
    const unitsPerInch = view.getInt16(14, true) || 1440; // Default to 1440 TWIPs

    const width = right - left;
    const height = bottom - top;

    // Convert to pixels (assuming 96 DPI)
    const pixelWidth = Math.round((width * 96) / unitsPerInch);
    const pixelHeight = Math.round((height * 96) / unitsPerInch);

    return {
      width: pixelWidth || 400,
      height: pixelHeight || 400,
      xExt: width || 400,
      yExt: height || 400,
    };
  }

  // Standard WMF without placeable header - use default dimensions
  return {
    width: 400,
    height: 400,
    xExt: 400,
    yExt: 400,
  };
}

/**
 * Converts an EMF image to SVG data URI.
 *
 * @param {string} data - Base64 encoded data or data URI of the EMF file
 * @param {{ width?: number, height?: number }} [size] - Optional size override
 * @returns {{ dataUri: string, format: string }|null} Data URI plus format, or null if conversion fails
 */
export function convertEmfToSvg(data, size = {}) {
  try {
    // Check if we're in a browser environment with DOM support (or a provided mock)
    if (!ensureDomEnvironment()) {
      console.warn('EMF conversion requires browser environment with DOM support');
      return null;
    }

    const buffer = base64ToArrayBuffer(data);

    // Try to extract embedded bitmap payloads before attempting SVG rendering.
    const dualText = hasEmfPlusDualText(buffer);
    const bitmapResult = dualText ? null : extractBitmapFromEmf(buffer);
    if (bitmapResult) {
      return bitmapResult;
    }

    const dimensions = getEmfDimensions(buffer);

    if (!dualText && isEmfPlus(buffer)) {
      // EMF+ payloads use GDI+ drawing records that rtf.js does not implement.
      // Many real-world EMF+ files (Office cover slides, charts) embed a complete
      // PNG/JPEG inside an EmfPlusObject(Image) record — extract that for a
      // pixel-perfect render before falling back to the placeholder.
      const embedded = extractBitmapFromEmfPlus(buffer);
      if (embedded) return embedded;

      return createPlaceholder({
        width: size.width || dimensions.width,
        height: size.height || dimensions.height,
        label: 'Unable to render EMF+ image',
      });
    }

    const renderSettings = {
      width: String(size.width || dimensions.width) + 'px',
      height: String(size.height || dimensions.height) + 'px',
      wExt: dimensions.wExt,
      hExt: dimensions.hExt,
      xExt: dimensions.xExt,
      yExt: dimensions.yExt,
      mapMode: MM_ANISOTROPIC,
    };

    let svgElement;
    try {
      svgElement = new EMFJS.Renderer(buffer, dualText).render(renderSettings);
    } catch (error) {
      if (!dualText || error.code !== 'unsupported-text-mode') throw error;
      // A valid Dual composition can use classic records the renderer cannot
      // handle. Preserve its embedded artwork when composition is unavailable.
      return extractBitmapFromEmf(buffer) ?? extractBitmapFromEmfPlus(buffer);
    }

    if (!svgElement?.childNodes?.length) {
      return null;
    }

    return { dataUri: svgToDataUri(svgElement), format: 'svg' };
  } catch (error) {
    console.warn('Failed to convert EMF to SVG:', error.message);
    return null;
  }
}

/**
 * Converts a WMF image to SVG data URI.
 *
 * @param {string} data - Base64 encoded data or data URI of the WMF file
 * @param {{ width?: number, height?: number }} [size] - Optional size override
 * @returns {{ dataUri: string, format: string }|null} Data URI plus format, or null if conversion fails
 */
export function convertWmfToSvg(data, size = {}) {
  try {
    // Check if we're in a browser environment with DOM support (or a provided mock)
    if (!ensureDomEnvironment()) {
      console.warn('WMF conversion requires browser environment with DOM support');
      return null;
    }

    const buffer = base64ToArrayBuffer(data);
    if (isEmfHeader(buffer)) {
      // Mis-labeled EMF (sometimes called WMF+) – handle with EMF path so EMF+/bitmap fallbacks apply.
      return convertEmfToSvg(data, size);
    }

    const dimensions = getWmfDimensions(buffer);

    const renderer = new WMFJS.Renderer(buffer);

    const renderSettings = {
      width: String(size.width || dimensions.width) + 'px',
      height: String(size.height || dimensions.height) + 'px',
      xExt: dimensions.xExt,
      yExt: dimensions.yExt,
      mapMode: MM_ANISOTROPIC,
    };

    const svgElement = renderer.render(renderSettings);
    if (!svgElement || !svgElement.childNodes?.length) return null;
    return { dataUri: svgToDataUri(svgElement), format: 'svg' };
  } catch (error) {
    console.warn('Failed to convert WMF to SVG:', error.message);
    return null;
  }
}

/**
 * Converts an EMF or WMF image to SVG data URI based on the file extension.
 *
 * @param {string} dataUri - Base64 data URI of the metafile
 * @param {string} extension - File extension ('emf' or 'wmf')
 * @param {{ width?: number, height?: number }} [size] - Optional size override
 * @returns {{ dataUri: string, format: string }|null} Data URI plus format, or null if conversion fails
 */
export function convertMetafileToSvg(dataUri, extension, size = {}) {
  const ext = extension?.toLowerCase();

  if (ext === 'emf') {
    return convertEmfToSvg(dataUri, size);
  }

  if (ext === 'wmf') {
    return convertWmfToSvg(dataUri, size);
  }

  console.warn(`Unsupported metafile extension: ${extension}`);
  return null;
}

/**
 * Checks if a file extension is a metafile format that can be converted.
 *
 * @param {string} extension - File extension to check
 * @returns {boolean} True if the extension is 'emf' or 'wmf'
 */
export function isMetafileExtension(extension) {
  const ext = extension?.toLowerCase();
  return ext === 'emf' || ext === 'wmf';
}
