import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import {
  FontRegistry,
  getFontRegistryFor,
  getDefaultFontRegistry,
  __resetDefaultFontRegistry,
  type FontSetLike,
  type FontFaceLike,
} from './index';

/** Extract the quoted family from a CSS `font` shorthand like `16px "Carlito"`. */
function parseFamily(font: string): string {
  const match = font.match(/"((?:[^"\\]|\\.)*)"/);
  return match ? match[1].replace(/\\(.)/g, '$1') : font.trim().split(/\s+/).slice(1).join(' ');
}

type Behavior = 'load-ok' | 'load-empty' | 'never' | 'reject';

class FakeFontFace implements FontFaceLike {
  status = 'unloaded';
  constructor(
    public readonly family: string,
    public readonly source: unknown,
    public readonly descriptors?: unknown,
  ) {}
  load(): Promise<FontFaceLike> {
    return Promise.resolve(this);
  }
}

/** Controllable FontFaceSet stand-in: per-family behavior + manual availability. */
class FakeFontSet implements FontSetLike {
  readonly added: FontFaceLike[] = [];
  readonly removed: FontFaceLike[] = [];
  readonly behaviors = new Map<string, Behavior>();
  readonly available = new Set<string>();
  readonly loadTexts: Array<string | undefined> = [];

  add(face: FontFaceLike): void {
    this.added.push(face);
  }
  delete(face: FontFaceLike): boolean {
    this.removed.push(face);
    const i = this.added.indexOf(face);
    if (i >= 0) this.added.splice(i, 1);
    return i >= 0;
  }
  load(font: string, text?: string): Promise<FontFaceLike[]> {
    this.loadTexts.push(text);
    const family = parseFamily(font);
    switch (this.behaviors.get(family) ?? 'load-empty') {
      case 'load-ok':
        this.available.add(family);
        return Promise.resolve([new FakeFontFace(family, 'x')]);
      case 'load-empty':
        return Promise.resolve([]);
      case 'reject':
        return Promise.reject(new Error('decode failed'));
      case 'never':
        return new Promise<FontFaceLike[]>(() => {});
    }
  }
  check(font: string): boolean {
    return this.available.has(parseFamily(font));
  }
}

/** Injectable timer the test can fire by hand, so `timed_out` is deterministic. */
function makeManualTimer() {
  const pending: Array<() => void> = [];
  return {
    scheduleTimeout: (cb: () => void) => {
      pending.push(cb);
      return pending.length - 1;
    },
    cancelTimeout: () => {},
    fire: () => {
      const due = pending.splice(0);
      due.forEach((cb) => cb());
    },
  };
}

function makeRegistry(fontSet: FakeFontSet, timer = makeManualTimer()) {
  const registry = new FontRegistry({
    fontSet,
    FontFaceCtor: FakeFontFace,
    scheduleTimeout: timer.scheduleTimeout,
    cancelTimeout: timer.cancelTimeout,
  });
  return { registry, timer };
}

describe('FontRegistry skeleton contract', () => {
  let fontSet: FakeFontSet;

  beforeEach(() => {
    fontSet = new FakeFontSet();
    __resetDefaultFontRegistry();
  });

  it('registers a managed face, adds it to the set, and tracks it as unloaded', () => {
    const { registry } = makeRegistry(fontSet);
    const result = registry.register({ family: 'Carlito', source: 'url(carlito.woff2)' });

    expect(result).toEqual({ family: 'Carlito', status: 'unloaded', changed: true });
    expect(registry.isManaged('Carlito')).toBe(true);
    expect(fontSet.added.map((f) => f.family)).toContain('Carlito');
    expect(registry.getStatus('Carlito')).toBe('unloaded');
  });

  it('re-registering the same face + same source is idempotent (changed:false, no duplicate face)', () => {
    const { registry } = makeRegistry(fontSet);
    registry.register({ family: 'Carlito', source: 'url(carlito.woff2)' });
    const again = registry.register({ family: 'Carlito', source: 'url(carlito.woff2)' });

    expect(again.changed).toBe(false);
    expect(fontSet.added.filter((f) => f.family === 'Carlito')).toHaveLength(1); // not added twice
  });

  it('treats url() quote variants of the same file as one source (idempotent, not a conflict)', () => {
    // The bundled pack registers `url(/x.woff2)` (unquoted) while `fonts.add` quotes to
    // `url("/x.woff2")`. They name the same file, so re-adding must be idempotent, not throw.
    const { registry } = makeRegistry(fontSet);
    registry.register({ family: 'Carlito', source: 'url(/fonts/Carlito.woff2)' });
    const again = registry.register({ family: 'Carlito', source: 'url("/fonts/Carlito.woff2")' });
    const singleQuoted = registry.register({ family: 'Carlito', source: "url('/fonts/Carlito.woff2')" });

    expect(again.changed).toBe(false);
    expect(singleQuoted.changed).toBe(false);
    expect(fontSet.added.filter((f) => f.family === 'Carlito')).toHaveLength(1); // not added per-variant
  });

  it('re-registering the same face with a DIFFERENT source throws (no silent overwrite)', () => {
    const { registry } = makeRegistry(fontSet);
    registry.register({ family: 'Carlito', source: 'url(carlito.woff2)' });

    expect(() => registry.register({ family: 'Carlito', source: 'url(other.woff2)' })).toThrow(
      /already registered from a different source/,
    );
  });

  it('reports `loaded` when a real face loads', async () => {
    fontSet.behaviors.set('Carlito', 'load-ok');
    const { registry } = makeRegistry(fontSet);

    const result = await registry.awaitFace('Carlito', 1000);

    expect(result).toEqual({ family: 'Carlito', status: 'loaded' });
    expect(registry.isAvailable('Carlito')).toBe(true);
  });

  it('reports `fallback_used` when no face matches the family', async () => {
    fontSet.behaviors.set('Aptos', 'load-empty');
    const { registry } = makeRegistry(fontSet);

    const result = await registry.awaitFace('Aptos', 1000);

    expect(result.status).toBe('fallback_used');
  });

  it('reports `failed` when the face load rejects', async () => {
    fontSet.behaviors.set('Broken', 'reject');
    const { registry } = makeRegistry(fontSet);

    const result = await registry.awaitFace('Broken', 1000);

    expect(result.status).toBe('failed');
  });

  it('reports `timed_out` when the load does not settle in budget', async () => {
    fontSet.behaviors.set('Slow', 'never');
    const { registry, timer } = makeRegistry(fontSet);

    const pending = registry.awaitFace('Slow', 1000);
    timer.fire();
    const result = await pending;

    expect(result.status).toBe('timed_out');
  });

  it('shares the in-flight probe for concurrent awaits of one family', () => {
    fontSet.behaviors.set('Carlito', 'never');
    const { registry } = makeRegistry(fontSet);

    const a = registry.awaitFace('Carlito', 1000);
    const b = registry.awaitFace('Carlito', 1000);

    expect(a).toBe(b);
  });

  it('awaitFaces de-duplicates and resolves every required family', async () => {
    fontSet.behaviors.set('Carlito', 'load-ok');
    fontSet.behaviors.set('Caladea', 'load-empty');
    const { registry } = makeRegistry(fontSet);

    const results = await registry.awaitFaces(['Carlito', 'Caladea', 'Carlito'], { timeoutMs: 1000 });

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.family === 'Carlito')?.status).toBe('loaded');
    expect(results.find((r) => r.family === 'Caladea')?.status).toBe('fallback_used');
  });

  it('exposes required faces as { family, status, ready } handles', async () => {
    fontSet.behaviors.set('Carlito', 'load-ok');
    const { registry } = makeRegistry(fontSet);

    const [handle] = registry.getRequiredFaces(['Carlito'], 1000);

    expect(handle.family).toBe('Carlito');
    expect(handle.status).toBe('unloaded'); // synchronous snapshot, before the await settles
    expect((await handle.ready).status).toBe('loaded');
  });

  it('quotes families with spaces so they resolve as one family', async () => {
    fontSet.behaviors.set('Times New Roman', 'load-ok');
    const { registry } = makeRegistry(fontSet);

    const result = await registry.awaitFace('Times New Roman', 1000);

    expect(result.status).toBe('loaded');
  });

  it('resolves to `fallback_used` with no font set (SSR)', async () => {
    const registry = new FontRegistry({});
    const result = await registry.awaitFace('Carlito', 1000);
    expect(result.status).toBe('fallback_used');
  });

  it('default registry is DOM-less under node and resolves to fallback', async () => {
    const registry = getDefaultFontRegistry();
    const result = await registry.awaitFace('Carlito', 1000);
    expect(result.status).toBe('fallback_used');
  });
});

describe('getFontRegistryFor', () => {
  beforeEach(() => __resetDefaultFontRegistry());

  it('returns the same registry for the same font set (shared per document)', () => {
    const setA = new FakeFontSet();
    const a1 = getFontRegistryFor(setA, FakeFontFace);
    const a2 = getFontRegistryFor(setA, FakeFontFace);
    expect(a1).toBe(a2);
  });

  it('returns distinct registries for distinct font sets (iframe isolation)', () => {
    const setA = new FakeFontSet();
    const setB = new FakeFontSet();
    expect(getFontRegistryFor(setA, FakeFontFace)).not.toBe(getFontRegistryFor(setB, FakeFontFace));
  });

  it('returns a shared DOM-less registry when no font set is given', () => {
    expect(getFontRegistryFor(null, null)).toBe(getFontRegistryFor(null, null));
  });
});

describe('FontRegistry face-aware APIs', () => {
  let fontSet: FakeFontSet;
  beforeEach(() => {
    fontSet = new FakeFontSet();
    __resetDefaultFontRegistry();
  });

  it('register seeds a face-level status from weight/style descriptors', () => {
    const { registry } = makeRegistry(fontSet);
    registry.register({
      family: 'Carlito',
      source: 'url(c-bold.woff2)',
      descriptors: { weight: 'bold', style: 'normal' },
    });
    expect(registry.getFaceStatus({ family: 'Carlito', weight: '700', style: 'normal' })).toBe('unloaded');
    // A different face of the same family is not implied by registering one.
    expect(registry.getFaceStatus({ family: 'Carlito', weight: '400', style: 'italic' })).toBe('unloaded');
  });

  it('awaitFaceRequest loads the exact face and rolls the family up to loaded', async () => {
    fontSet.behaviors.set('Carlito', 'load-ok');
    const { registry } = makeRegistry(fontSet);
    const res = await registry.awaitFaceRequest({ family: 'Carlito', weight: '700', style: 'italic' }, 1000);
    expect(res.status).toBe('loaded');
    expect(registry.getFaceStatus({ family: 'Carlito', weight: '700', style: 'italic' })).toBe('loaded');
    expect(registry.getStatus('Carlito')).toBe('loaded'); // family rollup for diagnostics
  });

  it('passes a text probe through so unicode-range can select a glyph-capable face', async () => {
    fontSet.behaviors.set('Core Symbols', 'load-ok');
    const { registry } = makeRegistry(fontSet);
    await registry.awaitFaceRequest(
      { family: 'Core Symbols', weight: '400', style: 'normal', text: '\u2708\u2610' },
      1000,
    );
    expect(fontSet.loadTexts).toEqual(['\u2708\u2610']);
  });

  it('awaitFaceRequests dedupes by face key but keeps distinct weight/style as separate faces', async () => {
    fontSet.behaviors.set('Liberation Sans', 'load-ok');
    const { registry } = makeRegistry(fontSet);
    const results = await registry.awaitFaceRequests(
      [
        { family: 'Liberation Sans', weight: '400', style: 'normal' },
        { family: 'Liberation Sans', weight: '400', style: 'normal' }, // dup
        { family: 'Liberation Sans', weight: '700', style: 'normal' },
      ],
      { timeoutMs: 1000 },
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'loaded')).toBe(true);
  });

  it('getStatus stays unloaded for a family registered but never awaited (not "missing")', () => {
    const { registry } = makeRegistry(fontSet);
    registry.register({
      family: 'Carlito',
      source: 'url(c.woff2)',
      descriptors: { weight: 'normal', style: 'normal' },
    });
    expect(registry.getStatus('Carlito')).toBe('unloaded');
  });

  it('a failed face surfaces in the family rollup when nothing else loaded', async () => {
    fontSet.behaviors.set('Broken', 'reject');
    const { registry } = makeRegistry(fontSet);
    const res = await registry.awaitFaceRequest({ family: 'Broken', weight: '400', style: 'normal' }, 1000);
    expect(res.status).toBe('failed');
    expect(registry.getStatus('Broken')).toBe('failed');
  });
});

describe('FontRegistry.registerOwnedFace (document-scoped embedded fonts)', () => {
  it('registers a binary face that hasFace sees, and its disposer removes exactly that face', () => {
    const fontSet = new FakeFontSet();
    const { registry } = makeRegistry(fontSet);
    // Two embedded faces of one family (binary) + an unrelated bundled/customer (URL) face.
    const releaseReg = registry.registerOwnedFace({
      family: 'EmbeddedCalibri',
      source: new ArrayBuffer(8),
      weight: '400',
      style: 'normal',
    });
    registry.registerOwnedFace({
      family: 'EmbeddedCalibri',
      source: new ArrayBuffer(8),
      weight: '700',
      style: 'normal',
    });
    registry.register({ family: 'Carlito', source: 'url(carlito.woff2)' });

    expect(registry.hasFace('EmbeddedCalibri', '400', 'normal')).toBe(true); // registered_face oracle sees it
    expect(releaseReg).toBeTypeOf('function');

    expect(releaseReg?.()).toBe(true);
    expect(registry.hasFace('EmbeddedCalibri', '400', 'normal')).toBe(false); // released
    expect(registry.hasFace('EmbeddedCalibri', '700', 'normal')).toBe(true); // sibling face untouched
    expect(registry.hasFace('Carlito', '400', 'normal')).toBe(true); // other family untouched
    expect(fontSet.removed).toHaveLength(1); // exactly one face deleted from the set

    // A second release is a no-op (idempotent disposer): no further removal.
    expect(releaseReg?.()).toBe(false);
    expect(fontSet.removed).toHaveLength(1);
  });

  it('clears family-level state only when the last owned face is released', () => {
    const fontSet = new FakeFontSet();
    const { registry } = makeRegistry(fontSet);
    const r400 = registry.registerOwnedFace({
      family: 'Doc',
      source: new ArrayBuffer(8),
      weight: '400',
      style: 'normal',
    });
    const r700 = registry.registerOwnedFace({
      family: 'Doc',
      source: new ArrayBuffer(8),
      weight: '700',
      style: 'normal',
    });

    r400?.();
    expect(registry.isManaged('Doc')).toBe(true); // 700 still there
    r700?.();
    expect(registry.isManaged('Doc')).toBe(false); // family fully released
    expect(registry.hasFace('Doc', '700', 'normal')).toBe(false);
  });

  it('keeps a shared key alive while another owner (a second document) still holds it', () => {
    // The registry is shared per FontFaceSet, so two documents can each register the SAME
    // family|weight|style. Releasing one document's face must NOT drop the other's.
    const fontSet = new FakeFontSet();
    const { registry } = makeRegistry(fontSet);
    const releaseDocA = registry.registerOwnedFace({
      family: 'Calibri',
      source: new ArrayBuffer(8),
      weight: '400',
      style: 'normal',
    });
    const releaseDocB = registry.registerOwnedFace({
      family: 'Calibri',
      source: new ArrayBuffer(16),
      weight: '400',
      style: 'normal',
    });
    expect(fontSet.added).toHaveLength(2); // two distinct faces (binary is never de-duped)

    expect(releaseDocA?.()).toBe(true);
    expect(registry.hasFace('Calibri', '400', 'normal')).toBe(true); // doc B's face still provides it
    expect(fontSet.removed).toHaveLength(1);

    expect(releaseDocB?.()).toBe(true);
    expect(registry.hasFace('Calibri', '400', 'normal')).toBe(false); // last owner gone
    expect(fontSet.removed).toHaveLength(2);
  });

  it('returns null with no FontFace constructor / font set (embedded bytes cannot render)', () => {
    const registry = new FontRegistry({});
    expect(
      registry.registerOwnedFace({ family: 'X', source: new ArrayBuffer(8), weight: '400', style: 'normal' }),
    ).toBeNull();
    expect(registry.hasFace('X', '400', 'normal')).toBe(false); // resolver falls through to the bundled substitute
  });
});

describe('hasFace oracle (provider-only, failure-aware, weight-bucketed)', () => {
  it('a REGISTERED face answers hasFace; a merely-AWAITED unregistered family does NOT (Fix A)', async () => {
    const fontSet = new FakeFontSet();
    const { registry } = makeRegistry(fontSet);
    registry.register({ family: 'Real', source: 'url(real.woff2)' });
    expect(registry.hasFace('Real', '400', 'normal')).toBe(true);

    // Awaiting an unregistered family tracks it for the status rollup, but it must NOT become a
    // provider face - else an as_requested family would flip to registered_face after the first await.
    await registry.awaitFaceRequest({ family: 'Ghost', weight: '400', style: 'normal' }, 1000);
    expect(registry.hasFace('Ghost', '400', 'normal')).toBe(false);
  });

  it('a terminally FAILED registered face drops out of hasFace; a TIMED_OUT one does not (Fix 2a)', async () => {
    const fontSet = new FakeFontSet();
    const { registry, timer } = makeRegistry(fontSet);
    registry.register({ family: 'Broken', source: 'url(broken.woff2)' });
    registry.register({ family: 'Slow', source: 'url(slow.woff2)' });
    expect(registry.hasFace('Broken', '400', 'normal')).toBe(true); // unloaded != failed
    expect(registry.hasFace('Slow', '400', 'normal')).toBe(true);

    fontSet.behaviors.set('Broken', 'reject');
    await registry.awaitFaceRequest({ family: 'Broken', weight: '400', style: 'normal' }, 1000);
    expect(registry.hasFace('Broken', '400', 'normal')).toBe(false); // failed -> ladder steps down to the clone

    fontSet.behaviors.set('Slow', 'never');
    const slow = registry.awaitFaceRequest({ family: 'Slow', weight: '400', style: 'normal' }, 1000);
    timer.fire(); // -> timed_out
    await slow;
    expect(registry.hasFace('Slow', '400', 'normal')).toBe(true); // timed_out stays available (late-load recovers)
  });

  it('an off-bucket registered weight answers the bucket key AND builds the FontFace at that weight (Fix 4)', () => {
    const fontSet = new FakeFontSet();
    const { registry } = makeRegistry(fontSet);
    registry.register({ family: 'Heavy', source: 'url(heavy.woff2)', descriptors: { weight: '500' } });
    // 500 buckets to 400: it answers the 400 query, not 700.
    expect(registry.hasFace('Heavy', '400', 'normal')).toBe(true);
    expect(registry.hasFace('Heavy', '700', 'normal')).toBe(false);
    // ...and the FontFace is built at the bucketed weight, so it renders 400 (not its true 500).
    const face = fontSet.added.find((f) => f.family === 'Heavy') as unknown as { descriptors?: { weight?: string } };
    expect(face?.descriptors?.weight).toBe('400');
  });
});

describe('bundled-substitute load-failure warning', () => {
  let fontSet: FakeFontSet;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fontSet = new FakeFontSet();
    __resetDefaultFontRegistry();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const bundledWarnings = () =>
    warn.mock.calls.map((c) => String(c[0])).filter((m) => /Bundled fallback fonts failed to load/.test(m));

  it('routes a failed bundled substitute to one actionable warning', async () => {
    // "Carlito" is a bundled substitute (in BUNDLED_MANIFEST).
    fontSet.behaviors.set('Carlito', 'reject');
    const { registry } = makeRegistry(fontSet);

    const result = await registry.awaitFace('Carlito', 1000);

    expect(result.status).toBe('failed');
    const warnings = bundledWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('@superdoc/fonts');
    expect(warnings[0]).toContain('fonts.assetBaseUrl');
  });

  it('fires the actionable warning only once across multiple bundled failures', async () => {
    fontSet.behaviors.set('Carlito', 'reject');
    fontSet.behaviors.set('Liberation Sans', 'reject');
    const { registry } = makeRegistry(fontSet);

    await registry.awaitFace('Carlito', 1000);
    await registry.awaitFace('Liberation Sans', 1000);

    expect(bundledWarnings()).toHaveLength(1);
  });

  it('does not fire the bundled warning for a customer font failure', async () => {
    fontSet.behaviors.set('MyBrandFont', 'reject');
    const { registry } = makeRegistry(fontSet);

    await registry.awaitFace('MyBrandFont', 1000);

    expect(bundledWarnings()).toHaveLength(0);
    // the generic per-family warning still fires, so the failure is never silent.
    const generic = warn.mock.calls.map((c) => String(c[0]));
    expect(generic.some((m) => /font asset failed to load for "MyBrandFont"/.test(m))).toBe(true);
  });
});
