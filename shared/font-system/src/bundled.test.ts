import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  BUNDLED_MANIFEST,
  DEFAULT_BUNDLED_FONT_BASE,
  installBundledSubstitutes,
  setBundledFontAssetBase,
} from './bundled';
import { FontRegistry, type FontFaceLike, type FontSetLike } from './registry';

type CreatedFace = { family: string; source: string; descriptors?: FontFaceDescriptors };

class RecordingRegistry {
  readonly registered: CreatedFace[] = [];
  readonly registry: FontRegistry;

  constructor() {
    const registered = this.registered;
    class RecordingFontFace implements FontFaceLike {
      constructor(family: string, source: string | ArrayBuffer | ArrayBufferView, descriptors?: FontFaceDescriptors) {
        registered.push({ family, source: typeof source === 'string' ? source : '', descriptors });
      }
      load(): Promise<FontFaceLike> {
        return Promise.resolve(this);
      }
    }
    const fontSet: FontSetLike = { add: () => {}, load: () => Promise.resolve([]), check: () => false };
    this.registry = new FontRegistry({ fontSet, FontFaceCtor: RecordingFontFace });
  }

  asRegistry(): FontRegistry {
    return this.registry;
  }

  sourcesFor(family: string): string[] {
    return this.registered.filter((r) => r.family === family).map((r) => r.source);
  }
}

const FACE_COUNT = BUNDLED_MANIFEST.reduce((n, f) => n + f.faces.length, 0);

describe('installBundledSubstitutes URL resolution', () => {
  beforeEach(() => setBundledFontAssetBase(DEFAULT_BUNDLED_FONT_BASE));

  it('registers every manifest face once with the default /fonts/ base', async () => {
    const reg = new RecordingRegistry();
    installBundledSubstitutes(reg.asRegistry());
    expect(reg.registered).toHaveLength(FACE_COUNT);
    const recorded = reg.registered
      .map(({ family, source, descriptors }) => `${family} | ${descriptors?.weight} ${descriptors?.style} | ${source}`)
      .join('\n');
    await expect(`${recorded}\n`).toMatchFileSnapshot('__snapshots__/bundled/default-base-faces.txt');
  });

  it('registers every shipped face with its generated cmap coverage', () => {
    const reg = new RecordingRegistry();
    installBundledSubstitutes(reg.asRegistry());
    expect(reg.registered.every((face) => typeof face.descriptors?.unicodeRange === 'string')).toBe(true);
    const carlito = reg.registered.find((face) => face.source.endsWith('/Carlito-Regular.woff2)'));
    expect(carlito?.descriptors?.unicodeRange).toContain('U+20-7E');
    expect(carlito?.descriptors?.unicodeRange).not.toContain('1F5F9');
  });

  it('uses assetBaseUrl and normalizes a missing trailing slash', () => {
    const reg = new RecordingRegistry();
    installBundledSubstitutes(reg.asRegistry(), { assetBaseUrl: 'https://cdn.example.com/superdoc-fonts/v1' });
    expect(reg.sourcesFor('Carlito')).toContain('url(https://cdn.example.com/superdoc-fonts/v1/Carlito-Regular.woff2)');
  });

  it('ignores a non-function resolveAssetUrl (raw misconfig), warns, and falls back to assetBaseUrl', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = new RecordingRegistry();
    // A hand-written `fonts.resolveAssetUrl` may be a string; calling it would throw at init. It must
    // be ignored (warned once) and fall back to the base-URL resolver instead of crashing.
    expect(() =>
      installBundledSubstitutes(reg.asRegistry(), {
        resolveAssetUrl: '/cdn/' as unknown as () => string,
        assetBaseUrl: 'https://cdn.example.com/fonts/',
      }),
    ).not.toThrow();
    expect(reg.sourcesFor('Carlito')).toContain('url(https://cdn.example.com/fonts/Carlito-Regular.woff2)');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/resolveAssetUrl must be a function/));
    warn.mockRestore();
  });

  it('warns about a non-function resolveAssetUrl once per document, not on every install call', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = new RecordingRegistry();
    const handle = reg.asRegistry();
    const opts = {
      resolveAssetUrl: '/cdn/' as unknown as () => string,
      assetBaseUrl: 'https://cdn.example.com/fonts/',
    };
    installBundledSubstitutes(handle, opts);
    installBundledSubstitutes(handle, opts); // idempotent for the same registry: must not re-warn
    expect(warn.mock.calls.filter((c) => /resolveAssetUrl must be a function/.test(String(c[0])))).toHaveLength(1);
    warn.mockRestore();
  });

  it('resolveAssetUrl wins over assetBaseUrl and receives per-face context', () => {
    const reg = new RecordingRegistry();
    const seen: { file: string; family: string; weight: string; style: string; source: string }[] = [];
    installBundledSubstitutes(reg.asRegistry(), {
      assetBaseUrl: '/ignored/',
      resolveAssetUrl: (ctx) => {
        seen.push(ctx);
        return `https://assets.example.com/${ctx.file}?v=1`;
      },
    });
    expect(reg.sourcesFor('Carlito')).toContain('url(https://assets.example.com/Carlito-Regular.woff2?v=1)');
    expect(seen.every((c) => c.source === 'bundled-substitute')).toBe(true);
    expect(seen).toContainEqual({
      file: 'Carlito-Bold.woff2',
      family: 'Carlito',
      weight: '700',
      style: 'normal',
      source: 'bundled-substitute',
    });
  });

  it('setBundledFontAssetBase overrides the default base', () => {
    setBundledFontAssetBase('https://cdn.jsdelivr.net/npm/@superdoc/fonts@1/assets/');
    const reg = new RecordingRegistry();
    installBundledSubstitutes(reg.asRegistry());
    expect(reg.sourcesFor('Caladea')).toContain(
      'url(https://cdn.jsdelivr.net/npm/@superdoc/fonts@1/assets/Caladea-Regular.woff2)',
    );
  });

  it('is idempotent per registry for the same config', () => {
    const reg = new RecordingRegistry();
    const handle = reg.asRegistry();
    installBundledSubstitutes(handle, { assetBaseUrl: '/fonts/' });
    installBundledSubstitutes(handle, { assetBaseUrl: '/fonts/' });
    expect(reg.registered).toHaveLength(FACE_COUNT);
  });

  it('keeps the first config and warns on a conflicting later install (shared registry)', () => {
    const reg = new RecordingRegistry();
    const handle = reg.asRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installBundledSubstitutes(handle, { assetBaseUrl: '/first/' });
    installBundledSubstitutes(handle, { assetBaseUrl: '/second/' }); // conflicting -> ignored + warns
    expect(reg.registered).toHaveLength(FACE_COUNT); // not re-registered
    expect(reg.sourcesFor('Carlito')).toContain('url(/first/Carlito-Regular.woff2)');
    expect(reg.sourcesFor('Carlito')).not.toContain('url(/second/Carlito-Regular.woff2)');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
