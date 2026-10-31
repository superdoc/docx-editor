import { describe, expect, it } from 'vite-plus/test';
import { normalizeInteractionConfig } from './normalize-interaction-config.js';
import { normalizeSurfacesConfig } from './normalize-surfaces-config.js';

describe('normalizeInteractionConfig', () => {
  it('permits mutations and shows resolve by default', () => {
    expect(normalizeInteractionConfig({})).toEqual({
      comments: { level: 'resolve', readOnly: false, allowResolve: true },
      trackedChanges: { allowDecisions: true },
    });
  });

  it.each([
    ['read', true, false],
    ['write', false, false],
    ['resolve', false, true],
  ])('resolves the %s comment level', (level, readOnly, allowResolve) => {
    expect(normalizeInteractionConfig({ interaction: { comments: { level } } }).comments).toEqual({
      level,
      readOnly,
      allowResolve,
    });
  });

  it('resolves tracked-change decisions independently from comment capability', () => {
    const policy = normalizeInteractionConfig({
      interaction: { comments: { level: 'read' }, trackedChanges: { allowDecisions: true } },
    });

    expect(policy.comments).toEqual({ level: 'read', readOnly: true, allowResolve: false });
    expect(policy.trackedChanges).toEqual({ allowDecisions: true });
  });

  it('still reads the deprecated fields on modules.comments', () => {
    const policy = normalizeInteractionConfig({
      modules: { comments: { readOnly: true, allowResolve: false } },
    });

    expect(policy).toEqual({
      comments: { level: 'read', readOnly: true, allowResolve: false },
      trackedChanges: { allowDecisions: false },
    });
  });

  it('keeps the deprecated interaction booleans backward compatible', () => {
    const policy = normalizeInteractionConfig({
      interaction: { comments: { readOnly: true, allowResolve: true } },
    });

    expect(policy).toEqual({
      comments: { level: 'read', readOnly: true, allowResolve: true },
      trackedChanges: { allowDecisions: false },
    });
  });

  it('prefers canonical fields on their own interaction axis', () => {
    const policy = normalizeInteractionConfig({
      interaction: {
        comments: { level: 'write', readOnly: true },
        trackedChanges: { allowDecisions: true },
      },
      modules: { comments: { readOnly: true, allowResolve: true } },
    });

    expect(policy).toEqual({
      comments: { level: 'write', readOnly: false, allowResolve: false },
      trackedChanges: { allowDecisions: true },
    });
  });

  it('ignores an invalid level and falls back to the supported configuration', () => {
    const policy = normalizeInteractionConfig({
      interaction: { comments: { level: 'comment', allowResolve: false } },
    });

    expect(policy.comments).toEqual({ level: 'write', readOnly: false, allowResolve: false });
  });

  it('survives modules.comments: false without reading it as permissive', () => {
    // Disabling the built-in UI says nothing about policy. The defaults apply,
    // and an explicit interaction block still wins.
    expect(normalizeInteractionConfig({ modules: { comments: false } })).toEqual({
      comments: { level: 'resolve', readOnly: false, allowResolve: true },
      trackedChanges: { allowDecisions: true },
    });

    const policy = normalizeInteractionConfig({
      ui: false,
      modules: { comments: false },
      interaction: { comments: { readOnly: true } },
    });

    expect(policy.comments.readOnly).toBe(true);
    expect(policy.trackedChanges.allowDecisions).toBe(false);
  });

  it('keeps policy independent of whether SuperDoc renders comments', () => {
    // The case that motivates the split: a custom comment UI needs readOnly
    // enforced even though no built-in comment surface exists.
    const policy = normalizeInteractionConfig({ ui: false, interaction: { comments: { readOnly: true } } });

    expect(policy.comments.readOnly).toBe(true);
  });
});

describe('normalizeSurfacesConfig', () => {
  it('defaults to no resolver and empty presets', () => {
    expect(normalizeSurfacesConfig({})).toEqual({ resolver: null, dialog: {}, floating: {} });
  });

  it('reads the canonical top-level block', () => {
    const resolver = () => null;
    const surfaces = normalizeSurfacesConfig({ surfaces: { resolver, dialog: { maxWidth: 480 } } });

    expect(surfaces.resolver).toBe(resolver);
    expect(surfaces.dialog).toEqual({ maxWidth: 480 });
  });

  it('still reads the legacy modules.surfaces block', () => {
    const resolver = () => null;
    const surfaces = normalizeSurfacesConfig({ modules: { surfaces: { resolver } } });

    expect(surfaces.resolver).toBe(resolver);
  });

  it('merges presets per key across both spellings', () => {
    const surfaces = normalizeSurfacesConfig({
      surfaces: { dialog: { maxWidth: 480 } },
      modules: { surfaces: { dialog: { closeOnEscape: false } } },
    });

    expect(surfaces.dialog).toEqual({ closeOnEscape: false, maxWidth: 480 });
  });

  it('ignores a non-function resolver rather than forwarding it', () => {
    expect(normalizeSurfacesConfig({ surfaces: { resolver: 'nope' } }).resolver).toBeNull();
  });

  it('lets an explicit null resolver clear the legacy one', () => {
    // Clearing a resolver inherited from the old spelling is the whole point
    // of writing `resolver: null` during a migration. Nullish-coalescing would
    // read that as "unset" and quietly keep the legacy function alive.
    const legacy = () => ({ type: 'none' });
    const surfaces = normalizeSurfacesConfig({
      surfaces: { resolver: null },
      modules: { surfaces: { resolver: legacy } },
    });

    expect(surfaces.resolver).toBeNull();
  });

  it('treats an undefined nested preset as unset rather than an override', () => {
    // Same rule as the resolver: a config built from optional properties can
    // carry `closeOnEscape: undefined` without meaning anything by it, and a
    // plain spread would erase the legacy value underneath.
    const undefinedOption = undefined;
    const surfaces = normalizeSurfacesConfig({
      surfaces: { dialog: { closeOnEscape: undefinedOption, maxWidth: 480 } },
      modules: { surfaces: { dialog: { closeOnEscape: false } } },
    });

    expect(surfaces.dialog).toEqual({ closeOnEscape: false, maxWidth: 480 });
  });

  it('treats an undefined resolver as unset rather than a clear', () => {
    // A config assembled with a spread or an optional property can carry
    // `resolver: undefined` without meaning anything by it, so presence alone
    // must not clear the legacy value. Only an explicit null clears.
    const legacy = () => ({ type: 'none' });
    const surfaces = normalizeSurfacesConfig({
      surfaces: { resolver: undefined },
      modules: { surfaces: { resolver: legacy } },
    });

    expect(surfaces.resolver).toBe(legacy);
  });

  it('stays live under ui: false', () => {
    // Turning off built-in chrome must not disable the mechanism the
    // application uses to open its own surfaces.
    const resolver = () => null;
    const surfaces = normalizeSurfacesConfig({ ui: false, surfaces: { resolver, floating: { placement: 'top' } } });

    expect(surfaces.resolver).toBe(resolver);
    expect(surfaces.floating).toEqual({ placement: 'top' });
  });

  it('does not carry built-in surface intents', () => {
    // findReplace is `ui.search` now; it must not leak back in through here.
    const surfaces = normalizeSurfacesConfig({ modules: { surfaces: { findReplace: true } } });

    expect(surfaces).toEqual({ resolver: null, dialog: {}, floating: {} });
  });
});
