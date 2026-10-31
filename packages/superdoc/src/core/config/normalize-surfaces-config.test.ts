import { describe, expect, it } from 'vite-plus/test';
import { normalizeSurfacesConfig } from './normalize-surfaces-config.js';

describe('normalizeSurfacesConfig merges both spellings', () => {
  it('keeps a legacy dialog key the new block omits, sets explicitly undefined, and clears the resolver with null', () => {
    const legacyResolver = () => ({ type: 'none' });
    const surfaces = normalizeSurfacesConfig({
      surfaces: { resolver: null, dialog: { maxWidth: 600, closeOnEscape: undefined } },
      modules: {
        surfaces: { resolver: legacyResolver, dialog: { closeOnEscape: false, closeOnBackdrop: false, maxWidth: 400 } },
      },
    });

    expect(surfaces).toEqual({
      resolver: null,
      dialog: { closeOnEscape: false, closeOnBackdrop: false, maxWidth: 600 },
      floating: {},
    });
  });

  it('merges floating presets per key with the new block winning', () => {
    const surfaces = normalizeSurfacesConfig({
      surfaces: { floating: { placement: 'bottom-left', width: undefined } },
      modules: { surfaces: { floating: { placement: 'top-right', width: 320, autoFocus: false } } },
    });

    expect(surfaces.floating).toEqual({ placement: 'bottom-left', width: 320, autoFocus: false });
  });

  it('keeps false and null preset values from the new block', () => {
    const surfaces = normalizeSurfacesConfig({
      surfaces: { dialog: { closeOnEscape: false, maxWidth: null } },
      modules: { surfaces: { dialog: { closeOnEscape: true, maxWidth: 400 } } },
    });

    expect(surfaces.dialog).toEqual({ closeOnEscape: false, maxWidth: null });
  });

  it('ignores keys a preset only inherits', () => {
    const inherited = Object.assign(Object.create({ maxWidth: 999 }), { closeOnBackdrop: false });
    const surfaces = normalizeSurfacesConfig({
      surfaces: { dialog: inherited },
      modules: { surfaces: { dialog: { maxWidth: 400 } } },
    });

    expect(surfaces.dialog).toEqual({ maxWidth: 400, closeOnBackdrop: false });
  });

  it.each([
    ['true', true],
    ['a string', 'dialog'],
    ['an array', [{ closeOnEscape: false }]],
    ['null', null],
  ])('ignores a top-level surfaces block that is %s', (_label, value) => {
    const legacyResolver = () => null;
    const surfaces = normalizeSurfacesConfig({
      surfaces: value,
      modules: { surfaces: { resolver: legacyResolver, dialog: { maxWidth: 400 } } },
    });

    expect(surfaces).toEqual({ resolver: legacyResolver, dialog: { maxWidth: 400 }, floating: {} });
  });

  it.each([
    ['true', true],
    ['an array', [{ closeOnEscape: false }]],
  ])('ignores a legacy modules.surfaces block that is %s', (_label, value) => {
    const surfaces = normalizeSurfacesConfig({ surfaces: { floating: { width: 200 } }, modules: { surfaces: value } });

    expect(surfaces).toEqual({ resolver: null, dialog: {}, floating: { width: 200 } });
  });

  it('ignores non-object presets in either spelling', () => {
    const surfaces = normalizeSurfacesConfig({
      surfaces: { dialog: true, floating: 'top' },
      modules: { surfaces: { dialog: { maxWidth: 400 }, floating: null } },
    });

    expect(surfaces).toEqual({ resolver: null, dialog: { maxWidth: 400 }, floating: {} });
  });
});
