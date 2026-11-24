import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createImageFilePicker, fileToDataUri, isSupportedImageFile, resolveImageSrc } from './image-upload.js';

const PNG_BYTES = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

function makePngFile(name = 'a.png'): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('isSupportedImageFile', () => {
  it('accepts PNG and JPEG mime types', () => {
    expect(isSupportedImageFile(new File([PNG_BYTES], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isSupportedImageFile(new File([PNG_BYTES], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(isSupportedImageFile(new File([PNG_BYTES], 'a.jpg', { type: 'image/jpg' }))).toBe(true);
  });

  it('rejects unsupported mime types', () => {
    expect(isSupportedImageFile(new File([PNG_BYTES], 'a.webp', { type: 'image/webp' }))).toBe(false);
    expect(isSupportedImageFile(new File([PNG_BYTES], 'a.gif', { type: 'image/gif' }))).toBe(false);
    expect(isSupportedImageFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBe(false);
    expect(isSupportedImageFile(null)).toBe(false);
  });

  it('falls back to the file extension when the type is empty', () => {
    expect(isSupportedImageFile(new File([PNG_BYTES], 'photo.JPEG', { type: '' }))).toBe(true);
    expect(isSupportedImageFile(new File([PNG_BYTES], 'photo.bmp', { type: '' }))).toBe(false);
  });
});

describe('fileToDataUri', () => {
  it('reads a file into a base64 data URI', async () => {
    const uri = await fileToDataUri(makePngFile());
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('infers the media type from the filename when the file has no type', async () => {
    const png = await fileToDataUri(new File([PNG_BYTES], 'photo.png', { type: '' }));
    expect(png.startsWith('data:image/png;base64,')).toBe(true);
    const jpeg = await fileToDataUri(new File([PNG_BYTES], 'photo.JPG', { type: '' }));
    expect(jpeg.startsWith('data:image/jpeg;base64,')).toBe(true);
  });
});

describe('resolveImageSrc', () => {
  it('embeds the file directly when no handleImageUpload is configured', async () => {
    const src = await resolveImageSrc(makePngFile(), undefined);
    expect(src.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('uses a data URI returned by handleImageUpload as-is', async () => {
    const custom = 'data:image/png;base64,QUJD';
    const src = await resolveImageSrc(makePngFile(), async () => custom);
    expect(src).toBe(custom);
  });

  it('fetches and embeds a remote URL returned by handleImageUpload', async () => {
    const blob = new Blob([PNG_BYTES], { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal('fetch', fetchMock);
    const src = await resolveImageSrc(makePngFile(), async () => 'https://example.test/pic.png');
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/pic.png');
    expect(src.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('keeps a usable media type when the fetched upload URL responds octet-stream', async () => {
    const blob = new Blob([PNG_BYTES], { type: 'application/octet-stream' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));
    const src = await resolveImageSrc(
      makePngFile('local-name.png'),
      async () => 'https://cdn.test/upload/pic.png?sig=abc',
    );
    expect(src.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('falls back to the picked filename when the upload URL has no extension', async () => {
    const blob = new Blob([PNG_BYTES], { type: 'application/octet-stream' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));
    const src = await resolveImageSrc(makePngFile('photo.JPG'), async () => 'https://cdn.test/objects/abc123');
    expect(src.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('fails closed when handleImageUpload returns an empty result', async () => {
    await expect(resolveImageSrc(makePngFile(), async () => '')).rejects.toThrow('empty result');
  });

  it('fails closed when the remote fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(resolveImageSrc(makePngFile(), async () => 'https://example.test/missing.png')).rejects.toThrow('404');
  });
});

describe('createImageFilePicker', () => {
  function pickFile(input: HTMLInputElement, file: File) {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  it('creates a hidden attached input with the PNG/JPEG accept filter', () => {
    const picker = createImageFilePicker({});
    expect(picker.input.isConnected).toBe(true);
    expect(picker.input.getAttribute('data-superdoc-image-picker')).toBe('true');
    expect(picker.input.accept).toBe('.png,.jpg,.jpeg,image/png,image/jpeg');
    expect(picker.input.hidden).toBe(true);
    picker.destroy();
    expect(picker.input.isConnected).toBe(false);
  });

  it('routes a supported picked file through onPick', async () => {
    const onPick = vi.fn();
    const onError = vi.fn();
    const picker = createImageFilePicker({ onPick, onError });
    pickFile(picker.input, makePngFile('pic.png'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].name).toBe('pic.png');
    expect(onError).not.toHaveBeenCalled();
    picker.destroy();
  });

  it('routes an unsupported picked file through onError without calling onPick', () => {
    const onPick = vi.fn();
    const onError = vi.fn();
    const picker = createImageFilePicker({ onPick, onError });
    pickFile(picker.input, new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(onPick).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    picker.destroy();
  });

  it('routes a rejected async onPick through onError', async () => {
    const onError = vi.fn();
    const picker = createImageFilePicker({
      onPick: () => Promise.reject(new Error('boom')),
      onError,
    });
    pickFile(picker.input, makePngFile());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('boom');
    picker.destroy();
  });
});
