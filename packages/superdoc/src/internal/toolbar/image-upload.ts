/**
 * Interactive image acquisition for the built-in toolbar (SD-3567).
 *
 * The toolbar image button routes through the shared controller command
 * `image` → `create.image`, which requires a base64 PNG/JPEG data-URI `src`.
 * This module owns the browser file picker and the File → data-URI
 * conversion; the toolbar dispatches the resulting payload through the
 * normal controller command path.
 */

/** Accept filter for the picker: PNG and JPEG only (V1 parity; OOXML-native formats). */
export const IMAGE_PICKER_ACCEPT = '.png,.jpg,.jpeg,image/png,image/jpeg';

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);
const SUPPORTED_IMAGE_EXTENSIONS = /\.(png|jpe?g)$/i;

type NamedBlob = Blob & { name?: string };

interface ImageFilePickerOptions {
  ownerDocument?: Document;
  onPick?: (file: File) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

interface ImageFilePicker {
  input: HTMLInputElement;
  open: () => void;
  destroy: () => void;
}

/**
 * Whether a picked/dropped file is an insertable image (PNG/JPEG). Falls back
 * to the file extension when the browser reports no MIME type.
 */
export function isSupportedImageFile(file: File | null | undefined): boolean {
  if (!file) return false;
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (type) return SUPPORTED_IMAGE_MIME_TYPES.has(type);
  return SUPPORTED_IMAGE_EXTENSIONS.test(String(file.name ?? ''));
}

/**
 * Read a File/Blob into a base64 data URI.
 *
 * Some browsers/OSes deliver picked files with an empty `type`; the picker
 * accepts those by extension, but `readAsDataURL` would then produce an
 * `application/octet-stream` data URI that `create.image` rejects. Rewrite
 * the media type from the filename so extension-accepted files still insert.
 */
export function fileToDataUri(file: NamedBlob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(normalizeImageDataUri(String(reader.result), file));
    reader.onerror = () => reject(reader.error ?? new Error('image-read-failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Ensure a data URI read from a supported file carries a PNG/JPEG media type.
 * Leaves URIs already typed as a supported image (or uninferable ones) alone.
 */
function normalizeImageDataUri(dataUri: string, file: NamedBlob | null | undefined): string {
  const match = /^data:([^;,]*);base64,/.exec(dataUri);
  if (!match) return dataUri;
  const mime = match[1].toLowerCase();
  if (SUPPORTED_IMAGE_MIME_TYPES.has(mime)) return dataUri;
  const name = String(file?.name ?? '');
  const inferred = /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.png$/i.test(name) ? 'image/png' : null;
  if (!inferred) return dataUri;
  return `data:${inferred};base64,${dataUri.slice(match[0].length)}`;
}

/**
 * Resolve the `create.image` src for a picked file. Uses the consumer's
 * `handleImageUpload` callback when configured (V1 contract:
 * `(file: File) => Promise<string>`). A returned non-data URL is fetched and
 * embedded, because `create.image` requires an embedded base64 data URI.
 */
export async function resolveImageSrc(
  file: File,
  handleImageUpload: ((file: File) => Promise<string>) | null | undefined,
): Promise<string> {
  if (typeof handleImageUpload === 'function') {
    const result = await handleImageUpload(file);
    if (typeof result !== 'string' || result.trim() === '') {
      throw new Error('handleImageUpload returned an empty result');
    }
    if (result.startsWith('data:')) return result;
    return embedRemoteImage(result, file);
  }
  return fileToDataUri(file);
}

/**
 * Fetch a remote image URL and embed it as a data URI. Object-store /
 * presigned URLs often respond `application/octet-stream`, so keep a filename
 * hint (URL path, falling back to the originally picked file) for the media
 * type normalization in `fileToDataUri`.
 */
async function embedRemoteImage(url: string, pickedFile: File | null | undefined): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`image fetch failed: ${response.status}`);
  }
  const blob = await response.blob();
  const urlName = /\.(?:png|jpe?g)(?:$|[?#])/i.test(url) ? url.split(/[?#]/)[0] : '';
  const name = urlName || pickedFile?.name || '';
  return fileToDataUri(name ? Object.assign(blob, { name }) : blob);
}

/**
 * Hidden `<input type=file>` picker bound to one toolbar instance. The input
 * stays attached (hidden) so automation and tests can drive it; `destroy()`
 * removes it. Picking a file calls `onPick(file)`; an unsupported type or a
 * failed pick routes through `onError(error)`.
 */
export function createImageFilePicker({
  ownerDocument = document,
  onPick,
  onError,
}: ImageFilePickerOptions = {}): ImageFilePicker {
  const input = ownerDocument.createElement('input');
  input.type = 'file';
  input.accept = IMAGE_PICKER_ACCEPT;
  input.hidden = true;
  input.tabIndex = -1;
  input.setAttribute('data-superdoc-image-picker', 'true');
  input.setAttribute('aria-hidden', 'true');
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    // Reset so re-picking the same file fires another change event.
    input.value = '';
    if (!file) return;
    if (!isSupportedImageFile(file)) {
      onError?.(new Error(`unsupported image type: ${file.type || file.name}`));
      return;
    }
    try {
      const result = onPick?.(file);
      if (result && typeof result.then === 'function') {
        result.catch((error: unknown) => onError?.(error));
      }
    } catch (error) {
      onError?.(error);
    }
  });
  ownerDocument.body?.appendChild(input);
  return {
    input,
    open() {
      input.click();
    },
    destroy() {
      input.remove();
    },
  };
}
