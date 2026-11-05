import { describe, expect, it, vi } from 'vite-plus/test';
import { installBundledSubstitutes } from './bundled';
import { BASELINE_BUNDLED, FontRegistry, createBundledActivation, createFontResolver, type FaceKey } from './index';

const reviewedFaces = [
  ['Caladea', ['Caladea', 'Caladea-Regular'], '400', 'normal', 'Caladea-Regular.woff2'],
  ['Caladea', ['Caladea Bold', 'Caladea-Bold'], '700', 'normal', 'Caladea-Bold.woff2'],
  ['Caladea', ['Caladea Italic', 'Caladea-Italic'], '400', 'italic', 'Caladea-Italic.woff2'],
  ['Caladea', ['Caladea Bold Italic', 'Caladea-BoldItalic'], '700', 'italic', 'Caladea-BoldItalic.woff2'],
  ['Carlito', ['Carlito'], '400', 'normal', 'Carlito-Regular.woff2'],
  ['Carlito', ['Carlito Bold', 'Carlito-Bold'], '700', 'normal', 'Carlito-Bold.woff2'],
  ['Carlito', ['Carlito Italic', 'Carlito-Italic'], '400', 'italic', 'Carlito-Italic.woff2'],
  ['Carlito', ['Carlito Bold Italic', 'Carlito-BoldItalic'], '700', 'italic', 'Carlito-BoldItalic.woff2'],
  ['Liberation Sans', ['Liberation Sans', 'LiberationSans'], '400', 'normal', 'LiberationSans-Regular.woff2'],
  ['Liberation Sans', ['Liberation Sans Bold', 'LiberationSans-Bold'], '700', 'normal', 'LiberationSans-Bold.woff2'],
  [
    'Liberation Sans',
    ['Liberation Sans Italic', 'LiberationSans-Italic'],
    '400',
    'italic',
    'LiberationSans-Italic.woff2',
  ],
  [
    'Liberation Sans',
    ['Liberation Sans Bold Italic', 'LiberationSans-BoldItalic'],
    '700',
    'italic',
    'LiberationSans-BoldItalic.woff2',
  ],
  ['Liberation Serif', ['Liberation Serif', 'LiberationSerif'], '400', 'normal', 'LiberationSerif-Regular.woff2'],
  [
    'Liberation Serif',
    ['Liberation Serif Bold', 'LiberationSerif-Bold'],
    '700',
    'normal',
    'LiberationSerif-Bold.woff2',
  ],
  [
    'Liberation Serif',
    ['Liberation Serif Italic', 'LiberationSerif-Italic'],
    '400',
    'italic',
    'LiberationSerif-Italic.woff2',
  ],
  [
    'Liberation Serif',
    ['Liberation Serif Bold Italic', 'LiberationSerif-BoldItalic'],
    '700',
    'italic',
    'LiberationSerif-BoldItalic.woff2',
  ],
] as const;

function setup() {
  const registry = new FontRegistry({ fontSet: null, FontFaceCtor: null });
  const register = vi.spyOn(registry, 'register');
  installBundledSubstitutes(registry, { assetBaseUrl: '/reviewed-fonts/' });
  const resolver = createFontResolver();
  const hasFace = registry.hasFace.bind(registry);
  return { registry, register, resolver, hasFace };
}

describe('SD-6689 reviewed face names preserve effective document axes', () => {
  for (const [canonical, names] of reviewedFaces) {
    for (const [, , weight, style, file] of reviewedFaces.filter(([family]) => family === canonical)) {
      for (const name of names) {
        it(`${name} selects ${file} for ${weight}/${style}`, () => {
          const { register, resolver, hasFace } = setup();
          const face = { weight, style };
          const canonicalResolution = resolver.resolveFace(canonical, face, hasFace);
          expect(canonicalResolution.physicalFamily).toBe(canonical);
          expect(canonicalResolution.reason).toBe('registered_face');
          const canonicalProvider = register.mock.calls
            .map(([input]) => input)
            .find(
              (input) =>
                input.family === canonical &&
                ['700', 'bold'].includes(String(input.descriptors?.weight)) === (weight === '700') &&
                input.descriptors?.style === style,
            );
          expect(canonicalProvider?.source).toBe(`url(/reviewed-fonts/${file})`);
          const resolution = resolver.resolveFace(name, face, hasFace);
          const provider = register.mock.calls
            .map(([input]) => input)
            .find(
              (input) =>
                input.family === resolution.physicalFamily &&
                ['700', 'bold'].includes(String(input.descriptors?.weight)) === (weight === '700') &&
                input.descriptors?.style === style,
            );
          expect(provider?.source).toBe(`url(/reviewed-fonts/${file})`);
          expect(resolution.logicalFamily).toBe(name);
          expect(hasFace(resolution.physicalFamily, weight, style)).toBe(true);
          expect(resolver.resolvePhysicalFamilyForFace(`"${name}", "Fallback, Inc.", serif`, face, hasFace)).toContain(
            '"Fallback, Inc.", serif',
          );
        });
      }
    }
  }

  it.each(['MyCaladea-Bold', 'Example-Regular', 'CaladeaBold', 'Carlito-Regular', 'LiberationSans-Regular'])(
    'does not invent a provider for %s',
    (name) => {
      const { resolver, hasFace } = setup();
      expect(resolver.resolveFace(name, { weight: '700', style: 'normal' }, hasFace)).toEqual({
        logicalFamily: name,
        physicalFamily: name,
        reason: 'as_requested',
      });
    },
  );

  it('does not activate an alias when the document has no configured pack', () => {
    const { hasFace } = setup();
    const resolver = createFontResolver(BASELINE_BUNDLED);
    expect(resolver.resolveFace('Caladea-Bold', { weight: '700', style: 'normal' }, hasFace)).toEqual({
      logicalFamily: 'Caladea-Bold',
      physicalFamily: 'Caladea-Bold',
      reason: 'as_requested',
    });
  });

  it('loads the independently specified bold asset through the existing explicit-map control', () => {
    const { register, resolver, hasFace } = setup();
    resolver.map('Caladea-Bold', 'Caladea');
    const resolution = resolver.resolveFace('Caladea-Bold', { weight: '700', style: 'normal' }, hasFace);
    expect(resolution.physicalFamily).toBe('Caladea');
    const source = register.mock.calls
      .map(([input]) => input)
      .find(
        (input) =>
          input.family === 'Caladea' && input.descriptors?.weight === 'bold' && input.descriptors?.style === 'normal',
      );
    expect(source?.source).toBe('url(/reviewed-fonts/Caladea-Bold.woff2)');
  });

  it.each([{ include: ['Calibri'] }, { include: ['Cambria'] }, { exclude: ['Calibri'] }])(
    'resolves physical aliases independently of logical-name curation %j',
    (selection) => {
      const { hasFace } = setup();
      const activation = createBundledActivation({ packConfigured: true, ...selection });
      const resolver = createFontResolver(activation);
      const face = { weight: '700', style: 'normal' } as const;
      expect(resolver.resolveFace('Carlito', face, hasFace).physicalFamily).toBe('Carlito');
      expect(resolver.resolveFace('Carlito-Bold', face, hasFace).physicalFamily).toBe('Carlito');
      expect(resolver.resolveFace('Calibri', face, hasFace).physicalFamily).toBe(
        activation.isActive('Calibri') ? 'Carlito' : 'Calibri',
      );
      expect(resolver.resolveFace('Cambria', face, hasFace).physicalFamily).toBe(
        activation.isActive('Cambria') ? 'Caladea' : 'Cambria',
      );
    },
  );

  it('does not apply a canonical-key custom mapping transitively to an alias', () => {
    const { registry, resolver, hasFace } = setup();
    registry.register({
      family: 'Customer Canonical',
      source: 'url(/customer/canonical.woff2)',
      descriptors: { weight: '700' },
    });
    resolver.map('Caladea', 'Customer Canonical');
    expect(resolver.resolveFace('Caladea', { weight: '700', style: 'normal' }, hasFace).physicalFamily).toBe(
      'Customer Canonical',
    );
    expect(resolver.resolveFace('Caladea-Bold', { weight: '700', style: 'normal' }, hasFace).physicalFamily).toBe(
      'Caladea',
    );
  });

  it('keeps an alias unresolved when the canonical provider lacks the requested style', () => {
    const { resolver, hasFace } = setup();
    const withoutBold = (family: string, weight: '400' | '700', style: 'normal' | 'italic') =>
      !(family === 'Caladea' && weight === '700') && hasFace(family, weight, style);
    expect(resolver.resolveFace('Caladea-Bold', { weight: '700', style: 'normal' }, withoutBold)).toEqual({
      logicalFamily: 'Caladea-Bold',
      physicalFamily: 'Caladea-Bold',
      reason: 'fallback_face_absent',
    });
  });

  it.each(['original', 'embedded', 'explicit'] as const)('keeps the %s provider ahead of a bundled alias', (kind) => {
    const { registry, resolver, hasFace } = setup();
    const logical = 'Caladea-Bold';
    const family = kind === 'original' ? logical : `Customer ${kind}`;
    registry.register({ family, source: 'url(/customer/bold.woff2)', descriptors: { weight: '700' } });
    if (kind === 'embedded') resolver.mapEmbedded(logical, family);
    if (kind === 'explicit') resolver.map(logical, family);
    const face: FaceKey = { weight: '700', style: 'normal' };
    expect(resolver.resolveFace(logical, face, hasFace)).toEqual({
      logicalFamily: logical,
      physicalFamily: family,
      reason: kind === 'explicit' ? 'custom_mapping' : 'registered_face',
    });
  });
});
