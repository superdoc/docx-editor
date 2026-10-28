import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test';

// The CDN build is baseline-by-default: importing cdn-entry must NOT mark the bundled pack
// present and must NOT change the font asset base. Consumers opt into the reviewed substitute
// pack with the separate `@superdoc/fonts` script (window.SuperDocFonts) instead. The heavy
// SuperDoc graph is stubbed so re-evaluation stays cheap and isolated; @superdoc/font-system is
// left real (vite.config aliases it to source under Vitest) so the real module state is observed.
vi.mock('./core/SuperDoc.js', () => ({ SuperDoc: class SuperDoc {} }));
vi.mock('./public/index.ts', () => ({}));

describe('cdn-entry is baseline-by-default (ships and activates no fonts)', () => {
  beforeEach(async () => {
    const { __resetBundledPackPresent } = await import('@superdoc/font-system');
    __resetBundledPackPresent();
    vi.resetModules();
  });

  afterEach(async () => {
    const { __resetBundledPackPresent } = await import('@superdoc/font-system');
    __resetBundledPackPresent();
    vi.resetModules();
  });

  it('does not mark the bundled pack present', async () => {
    await import('./cdn-entry.js');
    const { isBundledPackPresent } = await import('@superdoc/font-system');
    expect(isBundledPackPresent()).toBe(false);
  });

  it('leaves the default font asset base unchanged', async () => {
    const { getBundledFontAssetBase, DEFAULT_BUNDLED_FONT_BASE } = await import('@superdoc/font-system');
    const before = getBundledFontAssetBase();
    await import('./cdn-entry.js');
    expect(getBundledFontAssetBase()).toBe(before);
    expect(getBundledFontAssetBase()).toBe(DEFAULT_BUNDLED_FONT_BASE);
  });
});
