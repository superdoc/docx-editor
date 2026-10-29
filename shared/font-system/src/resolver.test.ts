import { describe, expect, it } from 'vite-plus/test';
import {
  BASELINE_BUNDLED,
  FULLY_ACTIVE_BUNDLED,
  createBundledActivation,
  createFontResolver,
  insertFontFamilyBeforeGeneric,
  resolveFontFamily,
  resolvePhysicalFamilies,
  resolvePhysicalFamily,
  resolvePrimaryPhysicalFamily,
} from './index';

describe('font stack insertion', () => {
  it('preserves quoted commas and treats a generic-named physical fallback as a named face', () => {
    expect(insertFontFamilyBeforeGeneric('"Acme, Inc.", sans-serif', 'Core Symbols')).toBe(
      '"Acme, Inc.", "Core Symbols", sans-serif',
    );
    expect(insertFontFamilyBeforeGeneric('Example Sans, sans-serif', 'serif')).toBe(
      'Example Sans, "serif", sans-serif',
    );
  });

  it('inserts a physical fallback before generic families and is idempotent', () => {
    expect(insertFontFamilyBeforeGeneric('"Example Sans", sans-serif', 'Core Symbols')).toBe(
      '"Example Sans", "Core Symbols", sans-serif',
    );
    expect(insertFontFamilyBeforeGeneric('Example Sans', 'Core Symbols')).toBe('Example Sans, "Core Symbols"');
    expect(insertFontFamilyBeforeGeneric('Example Sans, "Core Symbols", serif', 'Core Symbols')).toBe(
      'Example Sans, "Core Symbols", serif',
    );
  });
});

describe('font resolver', () => {
  it.each([
    '"Acme, Inc.", Arial, sans-serif',
    "'Acme, Inc.', Arial, sans-serif",
    '"Acme \\"Display, Inc.\\"", Arial, sans-serif',
    '"Acme\\\\, Inc.", Arial, sans-serif',
  ])('preserves complete quoted families in %s', (stack) => {
    const resolver = createFontResolver();
    expect(resolver.resolvePhysicalFamily(stack)).toBe(stack);
    for (const hasFace of [() => true, () => false]) {
      expect(resolver.resolvePhysicalFamilyForFace(stack, { weight: '400', style: 'normal' }, hasFace)).toBe(stack);
    }
  });

  it('replaces a complete quoted primary without splitting quoted fallback names', () => {
    const resolver = createFontResolver();
    resolver.map('Acme, Inc.', 'Sample 93');
    const input = '"Acme, Inc.", "Fallback, Ltd.", sans-serif';
    const expected = '"Sample 93", "Fallback, Ltd.", sans-serif';
    expect(resolver.resolvePhysicalFamily(input)).toBe(expected);
    expect(resolver.resolvePhysicalFamilyForFace(input, { weight: '400', style: 'normal' }, () => true)).toBe(expected);
    expect(resolver.resolveFontFamily(input).physicalFamily).toBe('Sample 93');
  });

  it.each([
    ['Bauhaus 93', '"Bauhaus 93"'],
    ['93 Example', '"93 Example"'],
    ['Example "Display" Face', '"Example \\"Display\\" Face"'],
    ['Example\\Display', '"Example\\\\Display"'],
  ])('quotes an unsafe mapped CSS family %s in both resolution paths', (physical, css) => {
    const resolver = createFontResolver();
    resolver.map('Example', physical);
    const expected = `${css}, Arial, sans-serif`;
    expect(resolver.resolvePhysicalFamily('Example, Arial, sans-serif')).toBe(expected);
    expect(
      resolver.resolvePhysicalFamilyForFace(
        'Example, Arial, sans-serif',
        { weight: '400', style: 'normal' },
        () => true,
      ),
    ).toBe(expected);
    expect(resolver.resolveFontFamily('Example').physicalFamily).toBe(physical);
  });

  it('quotes a numeric local family without replacing it or changing an already quoted stack', () => {
    const resolver = createFontResolver();
    const face = { weight: '400', style: 'normal' } as const;
    expect(resolver.resolvePhysicalFamily('Bauhaus 93, Arial, sans-serif')).toBe('"Bauhaus 93", Arial, sans-serif');
    for (const hasFace of [() => true, () => false]) {
      expect(resolver.resolvePhysicalFamilyForFace('Bauhaus 93, Arial, sans-serif', face, hasFace)).toBe(
        '"Bauhaus 93", Arial, sans-serif',
      );
      expect(resolver.resolvePhysicalFamilyForFace('"Bauhaus 93", Arial, sans-serif', face, hasFace)).toBe(
        '"Bauhaus 93", Arial, sans-serif',
      );
    }
    expect(resolver.resolveFontFamily('Bauhaus 93')).toEqual({
      logicalFamily: 'Bauhaus 93',
      physicalFamily: 'Bauhaus 93',
      reason: 'as_requested',
    });
  });

  it('maps bundled substitutions and category fallbacks (bare names)', () => {
    expect(resolvePhysicalFamily('Calibri')).toBe('Carlito');
    expect(resolvePhysicalFamily('Cambria')).toBe('Caladea');
    expect(resolvePhysicalFamily('Arial')).toBe('Liberation Sans');
    expect(resolvePhysicalFamily('Arial MT')).toBe('Liberation Sans');
    expect(resolvePhysicalFamily('Arial Black')).toBe('Archivo Black');
    expect(resolvePhysicalFamily('Times')).toBe('Liberation Serif');
    expect(resolvePhysicalFamily('Times New Roman')).toBe('Liberation Serif');
    expect(resolvePhysicalFamily('Courier')).toBe('Liberation Mono');
    expect(resolvePhysicalFamily('Courier New')).toBe('Liberation Mono');
    expect(resolvePhysicalFamily('Helvetica')).toBe('Liberation Sans');
    expect(resolvePhysicalFamily('Arial Narrow')).toBe('Liberation Sans Narrow');
    expect(resolvePhysicalFamily('Century')).toBe('C059');
    expect(resolvePhysicalFamily('Century Gothic')).toBe('URW Gothic');
    expect(resolvePhysicalFamily('Century Schoolbook')).toBe('C059');
    expect(resolvePhysicalFamily('Cooper Black')).toBe('Caprasimo');
    expect(resolvePhysicalFamily('Baskerville Old Face')).toBe('Bacasime Antique');
    expect(resolvePhysicalFamily('Bookman Old Style')).toBe('TeX Gyre Bonum');
    expect(resolvePhysicalFamily('ITC Bookman')).toBe('TeX Gyre Bonum');
    expect(resolvePhysicalFamily('Brush Script MT')).toBe('Oregano Italic');
    expect(resolvePhysicalFamily('Georgia')).toBe('Gelasio');
    expect(resolvePhysicalFamily('Garamond')).toBe('Cardo');
    expect(resolvePhysicalFamily('Consolas')).toBe('Inconsolata SemiExpanded');
    expect(resolvePhysicalFamily('Comic Sans MS')).toBe('Comic Relief');
    expect(resolvePhysicalFamily('Lucida Console')).toBe('Noto Sans Mono');
    expect(resolvePhysicalFamily('Segoe UI')).toBe('Selawik');
    expect(resolvePhysicalFamily('Tahoma')).toBe('Noto Sans');
    expect(resolvePhysicalFamily('Trebuchet MS')).toBe('PT Sans');
    expect(resolvePhysicalFamily('Verdana')).toBe('Noto Sans');
    expect(resolvePhysicalFamily('Gill Sans MT Condensed')).toBe('PT Sans Narrow');
  });

  it('resolves the PRIMARY family of a CSS stack and keeps the fallbacks', () => {
    // The real shape reaching measure/paint (toCssFontFamily output).
    expect(resolvePhysicalFamily('Calibri, sans-serif')).toBe('Carlito, sans-serif');
    expect(resolvePhysicalFamily('Times New Roman, serif')).toBe('Liberation Serif, serif');
    expect(resolvePhysicalFamily('Calibri , Arial , sans-serif')).toBe('Carlito, Arial, sans-serif');
  });

  it('is case- and quote-insensitive on the primary name', () => {
    expect(resolvePhysicalFamily('"CAMBRIA", serif')).toBe('Caladea, serif');
    expect(resolvePhysicalFamily('courier new')).toBe('Liberation Mono');
  });

  it('passes through a family with no known substitute', () => {
    // Aptos has no open clone, so it passes through unchanged.
    expect(resolvePhysicalFamily('Aptos')).toBe('Aptos');
    expect(resolveFontFamily('Aptos')).toEqual({
      logicalFamily: 'Aptos',
      physicalFamily: 'Aptos',
      reason: 'as_requested',
    });
  });

  it('reports the substitution reason + preserves the logical family', () => {
    expect(resolveFontFamily('Cambria')).toEqual({
      logicalFamily: 'Cambria',
      physicalFamily: 'Caladea',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('Georgia')).toEqual({
      logicalFamily: 'Georgia',
      physicalFamily: 'Gelasio',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('Baskerville Old Face')).toEqual({
      logicalFamily: 'Baskerville Old Face',
      physicalFamily: 'Bacasime Antique',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('Bookman Old Style')).toEqual({
      logicalFamily: 'Bookman Old Style',
      physicalFamily: 'TeX Gyre Bonum',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('ITC Bookman')).toEqual({
      logicalFamily: 'ITC Bookman',
      physicalFamily: 'TeX Gyre Bonum',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('Arial Narrow')).toEqual({
      logicalFamily: 'Arial Narrow',
      physicalFamily: 'Liberation Sans Narrow',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('Arial Black')).toEqual({
      logicalFamily: 'Arial Black',
      physicalFamily: 'Archivo Black',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('Arial MT')).toEqual({
      logicalFamily: 'Arial MT',
      physicalFamily: 'Liberation Sans',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('Century')).toEqual({
      logicalFamily: 'Century',
      physicalFamily: 'C059',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('Century Gothic')).toEqual({
      logicalFamily: 'Century Gothic',
      physicalFamily: 'URW Gothic',
      reason: 'category_fallback',
    });
    expect(resolveFontFamily('Century Schoolbook')).toEqual({
      logicalFamily: 'Century Schoolbook',
      physicalFamily: 'C059',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('Times')).toEqual({
      logicalFamily: 'Times',
      physicalFamily: 'Liberation Serif',
      reason: 'bundled_substitute',
    });
    expect(resolveFontFamily('Courier')).toEqual({
      logicalFamily: 'Courier',
      physicalFamily: 'Liberation Mono',
      reason: 'category_fallback',
    });
    expect(resolveFontFamily('Tahoma')).toEqual({
      logicalFamily: 'Tahoma',
      physicalFamily: 'Noto Sans',
      reason: 'category_fallback',
    });
    expect(resolveFontFamily('Segoe UI')).toEqual({
      logicalFamily: 'Segoe UI',
      physicalFamily: 'Selawik',
      reason: 'category_fallback',
    });
    expect(resolveFontFamily('Brush Script MT')).toEqual({
      logicalFamily: 'Brush Script MT',
      physicalFamily: 'Oregano Italic',
      reason: 'category_fallback',
    });
    expect(resolveFontFamily('Consolas')).toEqual({
      logicalFamily: 'Consolas',
      physicalFamily: 'Inconsolata SemiExpanded',
      reason: 'category_fallback',
    });
    expect(resolveFontFamily('Lucida Console')).toEqual({
      logicalFamily: 'Lucida Console',
      physicalFamily: 'Noto Sans Mono',
      reason: 'category_fallback',
    });
    expect(resolveFontFamily('Gill Sans MT Condensed')).toEqual({
      logicalFamily: 'Gill Sans MT Condensed',
      physicalFamily: 'PT Sans Narrow',
      reason: 'category_fallback',
    });
    expect(resolveFontFamily('Verdana')).toEqual({
      logicalFamily: 'Verdana',
      physicalFamily: 'Noto Sans',
      reason: 'category_fallback',
    });
    expect(resolveFontFamily('Calibri, sans-serif').logicalFamily).toBe('Calibri, sans-serif');
  });

  it('aliases Helvetica to the already-bundled Liberation Sans (metric_safe alias, no new asset)', () => {
    // docfonts records Helvetica -> Liberation Sans as metric_safe (0.000% analytic advance, all four
    // faces; resolver-alias only, no layout proof). Resolves like a bundled substitute, not a visual
    // fallback.
    expect(resolveFontFamily('Helvetica')).toEqual({
      logicalFamily: 'Helvetica',
      physicalFamily: 'Liberation Sans',
      reason: 'bundled_substitute',
    });
    // Resolves like the other clones: CSS stack keeps fallbacks, case/quote-insensitive.
    expect(resolvePhysicalFamily('Helvetica, Arial, sans-serif')).toBe('Liberation Sans, Arial, sans-serif');
    expect(resolvePhysicalFamily('"helvetica"')).toBe('Liberation Sans');
    expect(resolvePrimaryPhysicalFamily('Helvetica, sans-serif')).toBe('Liberation Sans');
  });

  it('extracts the bare physical face the gate must await', () => {
    expect(resolvePrimaryPhysicalFamily('Arial, sans-serif')).toBe('Liberation Sans');
    expect(resolvePrimaryPhysicalFamily('Verdana, sans-serif')).toBe('Noto Sans');
  });

  it('resolvePhysicalFamilies dedupes to the loadable face names', () => {
    expect(resolvePhysicalFamilies(['Calibri, sans-serif', 'Cambria', 'Calibri', 'Verdana']).sort()).toEqual([
      'Caladea',
      'Carlito',
      'Noto Sans',
    ]);
  });
});

describe('FontResolver (per-document context)', () => {
  it('is seeded with bundled DocFonts fallbacks', () => {
    const resolver = createFontResolver();
    expect(resolver.resolvePrimaryPhysicalFamily('Calibri')).toBe('Carlito');
    expect(resolver.resolvePhysicalFamily('Arial, sans-serif')).toBe('Liberation Sans, sans-serif');
    expect(resolver.version).toBe(0);
  });

  it('map() overrides the bundled default and reports custom_mapping', () => {
    const resolver = createFontResolver();
    resolver.map('Georgia', 'Gelasio');
    expect(resolver.resolvePrimaryPhysicalFamily('Georgia, serif')).toBe('Gelasio');
    expect(resolver.resolveFontFamily('Georgia')).toEqual({
      logicalFamily: 'Georgia',
      physicalFamily: 'Gelasio',
      reason: 'custom_mapping',
    });
    // An override beats the bundled map for the same logical family.
    resolver.map('Calibri', 'MyCalibri');
    expect(resolver.resolvePrimaryPhysicalFamily('Calibri')).toBe('MyCalibri');
  });

  it('version bumps on each distinct mapping change, not on no-ops', () => {
    const resolver = createFontResolver();
    resolver.map('Georgia', 'Gelasio');
    expect(resolver.version).toBe(1);
    resolver.map('Georgia', 'Gelasio'); // same -> no bump
    expect(resolver.version).toBe(1);
    resolver.unmap('Georgia');
    expect(resolver.version).toBe(2);
    resolver.unmap('Georgia'); // absent -> no bump
    expect(resolver.version).toBe(2);
    expect(resolver.resolvePrimaryPhysicalFamily('Georgia')).toBe('Gelasio'); // reverted to bundled default
  });

  it('identity self-map is a no-op, but an explicit pin to the bundled clone is a STORED override', () => {
    const norm = (f: string) => f.replace(/^["']|["']$/g, '').toLowerCase();
    const registeredBoth = (f: string) => norm(f) === 'calibri' || norm(f) === 'carlito';
    const resolver = createFontResolver();

    // Identity self-map (and a quoted/cased variant of it) is the ABSENCE of an override: dropped, so
    // the document keeps the shareable empty signature.
    resolver.map('Georgia', 'Georgia');
    resolver.map('"Georgia"', 'Georgia');
    expect(resolver.version).toBe(0);
    expect(resolver.signature).toBe('');

    // Mapping to the bundled CLONE is an explicit PIN, not a no-op (after provider precedence a
    // registered real Calibri would otherwise outrank the clone). It is stored as a custom_mapping.
    resolver.map('Calibri', 'Carlito');
    expect(resolver.signature).not.toBe('');
    expect(resolver.resolveFontFamily('Calibri')).toEqual({
      logicalFamily: 'Calibri',
      physicalFamily: 'Carlito',
      reason: 'custom_mapping',
    });
    // The pin wins even when a real Calibri face is registered (custom_mapping > registered_face).
    expect(resolver.resolveFace('Calibri', { weight: '400', style: 'normal' }, registeredBoth)).toMatchObject({
      physicalFamily: 'Carlito',
      reason: 'custom_mapping',
    });

    // unmap reverts to normal provider precedence (back to the shareable empty signature).
    resolver.unmap('Calibri');
    expect(resolver.signature).toBe('');
    expect(resolver.resolvePrimaryPhysicalFamily('Calibri')).toBe('Carlito');
  });

  it('isolates mappings per instance: two documents map the same logical family differently', () => {
    const docA = createFontResolver();
    const docB = createFontResolver();
    docA.map('Georgia', 'Gelasio');
    docB.map('Georgia', 'Tinos');

    expect(docA.resolvePrimaryPhysicalFamily('Georgia')).toBe('Gelasio');
    expect(docB.resolvePrimaryPhysicalFamily('Georgia')).toBe('Tinos');
    // A document with no override still gets the bundled default, unaffected by the others.
    expect(createFontResolver().resolvePrimaryPhysicalFamily('Georgia')).toBe('Gelasio');
    expect(docA.resolvePrimaryPhysicalFamily('Calibri')).toBe('Carlito'); // bundled map intact
  });

  it('signature is stable, order-independent, and distinguishes different mappings at the same version', () => {
    const empty = createFontResolver();
    expect(empty.signature).toBe(''); // default docs share cache safely

    const docA = createFontResolver();
    docA.map('Georgia', 'Gelasio');
    const docB = createFontResolver();
    docB.map('Georgia', 'Tinos');
    // Same version (1), DIFFERENT mappings -> signatures MUST differ (else measure/paint collide).
    expect(docA.version).toBe(docB.version);
    expect(docA.signature).not.toBe(docB.signature);

    // Order-independent: the same set of mappings yields the same signature regardless of insertion order.
    const x = createFontResolver();
    x.map('Georgia', 'Gelasio');
    x.map('Arial', 'MyArial');
    const y = createFontResolver();
    y.map('Arial', 'MyArial');
    y.map('Georgia', 'Gelasio');
    expect(x.signature).toBe(y.signature);

    // Identical mapping -> identical signature (safe cross-document cache sharing).
    const z = createFontResolver();
    z.map('Georgia', 'Gelasio');
    expect(z.signature).toBe(docA.signature);
  });

  it('reset() drops all overrides (document swap) and reverts to the bundled-only map', () => {
    const resolver = createFontResolver();
    resolver.map('Georgia', 'Gelasio');
    resolver.map('Calibri', 'MyCalibri');
    expect(resolver.signature).not.toBe('');

    resolver.reset();
    expect(resolver.signature).toBe(''); // back to default identity
    expect(resolver.resolvePrimaryPhysicalFamily('Georgia')).toBe('Gelasio'); // override gone, bundled default restored
    expect(resolver.resolvePrimaryPhysicalFamily('Calibri')).toBe('Carlito'); // bundled default restored
    expect(resolver.version).toBe(3); // 2 maps + 1 reset

    const before = resolver.version;
    resolver.reset(); // already empty -> no-op, no version bump
    expect(resolver.version).toBe(before);
  });

  it('signature returns to empty after map()+unmap() and converges regardless of add/remove order', () => {
    const resolver = createFontResolver();

    // map then unmap the SAME family -> signature reverts to '' (the memoized signature MUST
    // invalidate on unmap, not serve a stale non-empty value). Cross-render measure reuse depends
    // on this reversibility.
    resolver.map('Georgia', 'Gelasio');
    expect(resolver.signature).not.toBe('');
    resolver.unmap('Georgia');
    expect(resolver.signature).toBe('');

    // Two maps, unmapped in REVERSE order, fully revert to ''.
    resolver.map('Calibri', 'Carlito');
    resolver.map('Cambria', 'Caladea');
    expect(resolver.signature).not.toBe('');
    resolver.unmap('Cambria');
    resolver.unmap('Calibri');
    expect(resolver.signature).toBe('');

    // Order-independent: reaching the same {Georgia, Calibri} mapping set via different add/remove
    // paths converges to ONE signature, so two documents that arrived differently still share cache.
    const viaForward = createFontResolver();
    viaForward.map('Georgia', 'Gelasio');
    viaForward.map('Calibri', 'Carlito');

    const viaDetour = createFontResolver();
    viaDetour.map('Calibri', 'WrongFont');
    viaDetour.map('Georgia', 'Gelasio');
    viaDetour.unmap('Calibri');
    viaDetour.map('Calibri', 'Carlito');

    expect(viaDetour.signature).toBe(viaForward.signature);
  });

  it('trims the physical family and ignores empty/whitespace mappings', () => {
    const resolver = createFontResolver();
    resolver.map('Georgia', '  Gelasio  ');
    expect(resolver.resolvePrimaryPhysicalFamily('Georgia')).toBe('Gelasio'); // trimmed
    expect(resolver.version).toBe(1);
    resolver.map('Georgia', 'Gelasio'); // same after trim -> no bump
    expect(resolver.version).toBe(1);
    resolver.map('Verdana', '   '); // whitespace-only physical -> ignored
    expect(resolver.resolvePrimaryPhysicalFamily('Verdana')).toBe('Noto Sans');
    expect(resolver.version).toBe(1);
  });
});

describe('FontResolver (bundled activation gating)', () => {
  const norm = (f: string) => f.replace(/^["']|["']$/g, '').toLowerCase();

  it('no pack configured: bundled substitutes are inert and pass through as_requested', () => {
    const r = createFontResolver(BASELINE_BUNDLED);
    expect(r.resolvePrimaryPhysicalFamily('Calibri')).toBe('Calibri');
    expect(r.resolvePhysicalFamily('Calibri, sans-serif')).toBe('Calibri, sans-serif');
    expect(r.resolveFontFamily('Calibri')).toEqual({
      logicalFamily: 'Calibri',
      physicalFamily: 'Calibri',
      reason: 'as_requested',
    });
    // Even the baseline families render with system fonts when no pack is served.
    expect(r.resolvePrimaryPhysicalFamily('Arial')).toBe('Arial');
  });

  it('pack configured: substitutes apply, matching the default fully-active resolver', () => {
    const r = createFontResolver(FULLY_ACTIVE_BUNDLED);
    expect(r.resolvePrimaryPhysicalFamily('Calibri')).toBe('Carlito');
    expect(r.resolveFontFamily('Cambria')).toEqual({
      logicalFamily: 'Cambria',
      physicalFamily: 'Caladea',
      reason: 'bundled_substitute',
    });
  });

  it('curation gates substitution per logical family', () => {
    const excluded = createFontResolver(createBundledActivation({ packConfigured: true, exclude: ['Cooper Black'] }));
    expect(excluded.resolvePrimaryPhysicalFamily('Cooper Black')).toBe('Cooper Black'); // excluded -> inert
    expect(excluded.resolvePrimaryPhysicalFamily('Calibri')).toBe('Carlito'); // others still substitute

    const only = createFontResolver(createBundledActivation({ packConfigured: true, include: ['Calibri'] }));
    expect(only.resolvePrimaryPhysicalFamily('Calibri')).toBe('Carlito');
    expect(only.resolvePrimaryPhysicalFamily('Cambria')).toBe('Cambria'); // not included -> inert
  });

  it('an explicit fonts.map override is honored even with no pack (customer instruction, not a suggestion)', () => {
    const r = createFontResolver(BASELINE_BUNDLED);
    r.map('Calibri', 'MyCalibri');
    expect(r.resolveFontFamily('Calibri')).toEqual({
      logicalFamily: 'Calibri',
      physicalFamily: 'MyCalibri',
      reason: 'custom_mapping',
    });
  });

  it('a registered real face is honored with no pack; an inactive bundled clone is treated as no provider', () => {
    const r = createFontResolver(BASELINE_BUNDLED);
    const face = { weight: '400', style: 'normal' } as const;
    // Customer fonts.add registered a real Calibri face -> render it (registered_face).
    expect(r.resolveFace('Calibri', face, (f) => norm(f) === 'calibri')).toMatchObject({
      physicalFamily: 'Calibri',
      reason: 'registered_face',
    });
    // No registered face and no pack: the clone is inert, so the family passes through as_requested
    // (NOT fallback_face_absent - an inactive clone is no provider, not a present-but-faceless one).
    expect(r.resolveFace('Calibri', face, () => false)).toMatchObject({
      physicalFamily: 'Calibri',
      reason: 'as_requested',
    });
  });

  it('activation is folded into the signature: no-pack and curated are isolated; full-pack == default', () => {
    const baseline = createFontResolver(BASELINE_BUNDLED);
    const full = createFontResolver(FULLY_ACTIVE_BUNDLED);
    const def = createFontResolver(); // defaults to fully active
    const excl = createFontResolver(createBundledActivation({ packConfigured: true, exclude: ['Calibri'] }));

    // A configured full-pack document shares the empty (cache-sharing) signature with the default.
    expect(full.signature).toBe('');
    expect(def.signature).toBe('');
    // No-pack and curated documents get distinct, non-empty signatures, so their measures never
    // collide with a full-pack document's.
    expect(baseline.signature).not.toBe('');
    expect(excl.signature).not.toBe('');
    expect(new Set([baseline.signature, full.signature, excl.signature]).size).toBe(3);
  });

  it('setActivation re-gates resolution and busts the signature; re-applying the same is a no-op', () => {
    const r = createFontResolver(); // fully active
    expect(r.resolvePrimaryPhysicalFamily('Calibri')).toBe('Carlito');
    expect(r.signature).toBe('');

    r.setActivation(BASELINE_BUNDLED);
    expect(r.resolvePrimaryPhysicalFamily('Calibri')).toBe('Calibri'); // now inert
    expect(r.signature).not.toBe('');

    const v = r.version;
    r.setActivation(createBundledActivation({ packConfigured: false })); // same signature -> no bump
    expect(r.version).toBe(v);
  });

  it('signature composes activation with overrides', () => {
    const a = createFontResolver(BASELINE_BUNDLED);
    a.map('Georgia', 'Gelasio');
    const b = createFontResolver(BASELINE_BUNDLED);
    b.map('Georgia', 'Tinos');
    // Same activation, different overrides -> distinct signatures.
    expect(a.signature).not.toBe(b.signature);
    // Same override under a DIFFERENT activation -> distinct signature (activation folded in).
    const c = createFontResolver(FULLY_ACTIVE_BUNDLED);
    c.map('Georgia', 'Gelasio');
    expect(a.signature).not.toBe(c.signature);
  });
});

describe('face-aware resolution (resolveFace / resolvePhysicalFamilyForFace)', () => {
  const norm = (f: string) => f.replace(/^["']|["']$/g, '').toLowerCase();
  // Realistic registries: the bundled CLONE (Carlito) is registered but the logical Calibri is NOT -
  // the normal bundled-substitute case. `registered` lets a test say a logical family has a real face.
  const cloneFaces = (f: string) => norm(f) === 'carlito';
  const registered = (...families: string[]) => {
    const set = new Set(families.map(norm));
    return (f: string) => set.has(norm(f));
  };
  const regularOnly = (_f: string, w: '400' | '700', s: 'normal' | 'italic') => w === '400' && s === 'normal';
  const noFaces = () => false;
  const FACES = [
    { weight: '400', style: 'normal' },
    { weight: '700', style: 'normal' },
    { weight: '400', style: 'italic' },
    { weight: '700', style: 'italic' },
  ] as const;

  it('four-face clones substitute on EVERY face when the logical family is NOT registered', () => {
    const r = createFontResolver();
    for (const face of FACES) {
      // Calibri has no registered real face; the bundled Carlito clone does -> bundled_substitute.
      expect(r.resolveFace('Calibri', face, cloneFaces)).toEqual({
        logicalFamily: 'Calibri',
        physicalFamily: 'Carlito',
        reason: 'bundled_substitute',
      });
      expect(r.resolvePhysicalFamilyForFace('Calibri, sans-serif', face, cloneFaces)).toBe('Carlito, sans-serif');
    }
  });

  it('a REGISTERED real face for the logical family wins over the bundled substitute (registered_face)', () => {
    const r = createFontResolver();
    // A customer `fonts.add` registered real Calibri faces under the logical name (document-agnostic, so
    // the physical IS the logical family). Embedded document fonts take a separate path - a
    // document-unique physical family via `mapEmbedded` (see the embedded-provider-identity tests below).
    for (const face of FACES) {
      expect(r.resolveFace('Calibri', face, registered('Calibri'))).toEqual({
        logicalFamily: 'Calibri',
        physicalFamily: 'Calibri', // the real family, NOT Carlito
        reason: 'registered_face',
      });
      // CSS stack is unchanged (the registered Calibri face renders), no swap to the clone.
      expect(r.resolvePhysicalFamilyForFace('Calibri, sans-serif', face, registered('Calibri'))).toBe(
        'Calibri, sans-serif',
      );
    }
    // Per face: a registered Bold but Regular-only-clone family still prefers the real Bold.
    expect(r.resolveFace('Calibri', { weight: '700', style: 'normal' }, registered('Calibri')).reason).toBe(
      'registered_face',
    );
  });

  it('an explicit fonts.map override wins over a registered real face', () => {
    const r = createFontResolver();
    r.map('Calibri', 'Tinos');
    // Even though Calibri is registered, the explicit map to Tinos takes precedence (still face-aware).
    expect(r.resolveFace('Calibri', { weight: '400', style: 'normal' }, registered('Calibri', 'Tinos'))).toEqual({
      logicalFamily: 'Calibri',
      physicalFamily: 'Tinos',
      reason: 'custom_mapping',
    });
  });

  it('when the mapped target lacks the face but the logical family is registered, use the real face (not missing)', () => {
    const r = createFontResolver();
    r.map('Calibri', 'Tinos'); // Tinos is Regular-only; real Calibri is registered for every face.
    const hasFace = (f: string, w: '400' | '700', s: 'normal' | 'italic') => {
      if (norm(f) === 'calibri') return true; // real Calibri: all faces
      if (norm(f) === 'tinos') return w === '400' && s === 'normal'; // Tinos: Regular only
      return false;
    };
    // Regular: the explicit map to Tinos applies (Tinos has Regular).
    expect(r.resolveFace('Calibri', { weight: '400', style: 'normal' }, hasFace)).toMatchObject({
      physicalFamily: 'Tinos',
      reason: 'custom_mapping',
    });
    // Bold: Tinos lacks it, but real Calibri Bold is registered -> render the real face, NOT a
    // fallback_face_absent that would be reported missing.
    expect(r.resolveFace('Calibri', { weight: '700', style: 'normal' }, hasFace)).toEqual({
      logicalFamily: 'Calibri',
      physicalFamily: 'Calibri',
      reason: 'registered_face',
    });
  });

  it('custom map with one registered target face maps that face and passes other faces through', () => {
    const r = createFontResolver();
    r.map('Georgia', 'Gelasio'); // custom target with Regular only registered in this test
    expect(r.resolveFace('Georgia', { weight: '400', style: 'normal' }, regularOnly)).toEqual({
      logicalFamily: 'Georgia',
      physicalFamily: 'Gelasio',
      reason: 'custom_mapping',
    });
    // Bold/italic: substitute lacks the face -> pass the LOGICAL family through, reported non-metric.
    expect(r.resolveFace('Georgia', { weight: '700', style: 'normal' }, regularOnly)).toEqual({
      logicalFamily: 'Georgia',
      physicalFamily: 'Georgia',
      reason: 'fallback_face_absent',
    });
    expect(r.resolveFace('Georgia', { weight: '400', style: 'italic' }, regularOnly).reason).toBe(
      'fallback_face_absent',
    );
    // CSS-stack variant: substitute only the present face; return the value UNCHANGED for an absent
    // face (so the painter never faux-styles the substitute's Regular).
    expect(r.resolvePhysicalFamilyForFace('Georgia, serif', { weight: '400', style: 'normal' }, regularOnly)).toBe(
      'Gelasio, serif',
    );
    expect(r.resolvePhysicalFamilyForFace('Georgia, serif', { weight: '700', style: 'normal' }, regularOnly)).toBe(
      'Georgia, serif',
    );
  });

  it('single-face bundled substitute: Cooper Black uses DocFonts-approved synthetic faces', () => {
    const r = createFontResolver();
    const caprasimoRegular = (f: string, w: '400' | '700', s: 'normal' | 'italic') =>
      norm(f) === 'caprasimo' && w === '400' && s === 'normal';
    expect(r.resolveFace('Cooper Black', { weight: '400', style: 'normal' }, caprasimoRegular)).toEqual({
      logicalFamily: 'Cooper Black',
      physicalFamily: 'Caprasimo',
      reason: 'bundled_substitute',
    });
    expect(
      r.resolvePhysicalFamilyForFace('Cooper Black, serif', { weight: '400', style: 'normal' }, caprasimoRegular),
    ).toBe('Caprasimo, serif');
    for (const face of [
      { weight: '700' as const, style: 'normal' as const },
      { weight: '400' as const, style: 'italic' as const },
      { weight: '700' as const, style: 'italic' as const },
    ]) {
      expect(r.resolveFace('Cooper Black', face, caprasimoRegular)).toEqual({
        logicalFamily: 'Cooper Black',
        physicalFamily: 'Caprasimo',
        reason: 'bundled_substitute',
        sourceFace: { weight: '400', style: 'normal' },
      });
      expect(r.resolvePhysicalFamilyForFace('Cooper Black, serif', face, caprasimoRegular)).toBe('Caprasimo, serif');
    }
  });

  it('new reviewed rows use their DocFonts face sources without inventing missing files', () => {
    const r = createFontResolver();
    const reviewedBatchFaces = (f: string, w: '400' | '700', s: 'normal' | 'italic') => {
      if (norm(f) === 'bacasime antique') return w === '400' && s === 'normal';
      if (norm(f) === 'oregano italic') return w === '400' && s === 'normal';
      if (norm(f) === 'noto sans mono') return s === 'normal' && (w === '400' || w === '700');
      if (norm(f) === 'pt sans narrow') return s === 'normal' && (w === '400' || w === '700');
      return false;
    };

    expect(r.resolveFace('Baskerville Old Face', { weight: '700', style: 'italic' }, reviewedBatchFaces)).toMatchObject(
      {
        physicalFamily: 'Bacasime Antique',
        reason: 'bundled_substitute',
        sourceFace: { weight: '400', style: 'normal' },
      },
    );
    expect(r.resolveFace('Brush Script MT', { weight: '700', style: 'normal' }, reviewedBatchFaces)).toMatchObject({
      physicalFamily: 'Oregano Italic',
      reason: 'category_fallback',
      sourceFace: { weight: '400', style: 'normal' },
    });
    expect(r.resolveFace('Lucida Console', { weight: '700', style: 'normal' }, reviewedBatchFaces)).toMatchObject({
      physicalFamily: 'Noto Sans Mono',
      reason: 'category_fallback',
    });
    expect(r.resolveFace('Lucida Console', { weight: '700', style: 'italic' }, reviewedBatchFaces)).toMatchObject({
      physicalFamily: 'Noto Sans Mono',
      reason: 'category_fallback',
      sourceFace: { weight: '700', style: 'normal' },
    });
    expect(
      r.resolveFace('Arial Black', { weight: '400', style: 'italic' }, (f, w, s) => {
        return norm(f) === 'archivo black' && w === '400' && s === 'normal';
      }),
    ).toMatchObject({
      physicalFamily: 'Archivo Black',
      reason: 'bundled_substitute',
      sourceFace: { weight: '400', style: 'normal' },
    });
    expect(
      r.resolveFace('Arial Black', { weight: '700', style: 'normal' }, (f, w, s) => {
        return norm(f) === 'archivo black' && w === '400' && s === 'normal';
      }),
    ).toMatchObject({
      logicalFamily: 'Arial Black',
      physicalFamily: 'Arial Black',
      reason: 'fallback_face_absent',
    });
    expect(
      r.resolveFace('Gill Sans MT Condensed', { weight: '700', style: 'italic' }, reviewedBatchFaces),
    ).toMatchObject({
      physicalFamily: 'PT Sans Narrow',
      reason: 'category_fallback',
      sourceFace: { weight: '700', style: 'normal' },
    });
  });

  it('single-face bundled substitute: a real requested substitute face beats a synthetic source face', () => {
    const r = createFontResolver();
    const caprasimoRegularAndBold = (f: string, w: '400' | '700', s: 'normal' | 'italic') =>
      norm(f) === 'caprasimo' && (w === '400' || w === '700') && s === 'normal';

    expect(r.resolveFace('Cooper Black', { weight: '700', style: 'normal' }, caprasimoRegularAndBold)).toEqual({
      logicalFamily: 'Cooper Black',
      physicalFamily: 'Caprasimo',
      reason: 'bundled_substitute',
    });
    expect(
      r.resolvePhysicalFamilyForFace(
        'Cooper Black, serif',
        { weight: '700', style: 'normal' },
        caprasimoRegularAndBold,
      ),
    ).toBe('Caprasimo, serif');
  });

  it('map to an UNREGISTERED physical family passes through (fallback_face_absent), never faux-styled', () => {
    const r = createFontResolver();
    r.map('Georgia', 'Some System Font'); // not bundled, not added via fonts.add() -> hasFace false
    expect(r.resolveFace('Georgia', { weight: '400', style: 'normal' }, noFaces)).toEqual({
      logicalFamily: 'Georgia',
      physicalFamily: 'Georgia',
      reason: 'fallback_face_absent',
    });
    expect(r.resolvePhysicalFamilyForFace('Georgia', { weight: '400', style: 'normal' }, noFaces)).toBe('Georgia');
  });

  it('an unmapped family with no substitute is as_requested regardless of hasFace', () => {
    const r = createFontResolver();
    expect(r.resolveFace('Aptos', { weight: '400', style: 'normal' }, noFaces)).toEqual({
      logicalFamily: 'Aptos',
      physicalFamily: 'Aptos',
      reason: 'as_requested',
    });
  });

  it('strips surrounding quotes from a quoted registered family (registered_face returns the bare family)', () => {
    const r = createFontResolver();
    // A quoted CSS primary for a registered real Calibri: physicalFamily MUST be the bare 'Calibri'
    // (case preserved), not '"Calibri"'. Otherwise the load/preload probe (faceProbe -> quoteFamily)
    // quotes it again and the browser probes a literal "Calibri" that never matches the registered face.
    expect(r.resolveFace('"Calibri", sans-serif', { weight: '400', style: 'normal' }, registered('Calibri'))).toEqual({
      logicalFamily: '"Calibri", sans-serif',
      physicalFamily: 'Calibri',
      reason: 'registered_face',
    });
    // The CSS paint variant KEEPS the quoted stack (valid CSS); measure awaits the bare family above.
    expect(
      r.resolvePhysicalFamilyForFace(
        '"Calibri", sans-serif',
        { weight: '400', style: 'normal' },
        registered('Calibri'),
      ),
    ).toBe('"Calibri", sans-serif');
  });

  it('strips quotes for as_requested and fallback_face_absent structured returns (case preserved)', () => {
    const r = createFontResolver();
    // as_requested: no provider; the bare, case-preserved family passes through.
    expect(r.resolveFace('"Aptos"', { weight: '400', style: 'normal' }, noFaces)).toMatchObject({
      physicalFamily: 'Aptos',
      reason: 'as_requested',
    });
    // fallback_face_absent: a mapped substitute that cannot supply the face -> the bare logical family.
    r.map('Georgia', 'Some System Font'); // unregistered target (noFaces) -> override known but no face
    expect(r.resolveFace('"Georgia"', { weight: '400', style: 'normal' }, noFaces)).toMatchObject({
      physicalFamily: 'Georgia',
      reason: 'fallback_face_absent',
    });
  });
});

describe('category_fallback (non-metric family fallback: Calibri Light -> Carlito)', () => {
  const norm = (f: string) => f.replace(/^["']|["']$/g, '').toLowerCase();
  const carlito = (f: string) => norm(f) === 'carlito'; // bundled Carlito is registered; Calibri Light is not
  const noFaces = () => false;
  const R400 = { weight: '400', style: 'normal' } as const;

  it('family-level: Calibri Light -> Carlito with reason category_fallback (NOT bundled_substitute)', () => {
    expect(resolveFontFamily('Calibri Light')).toEqual({
      logicalFamily: 'Calibri Light',
      physicalFamily: 'Carlito',
      reason: 'category_fallback',
    });
    // Calibri (Regular) stays a metric clone, unaffected.
    expect(resolveFontFamily('Calibri').reason).toBe('bundled_substitute');
    // CSS stack keeps fallbacks; case/quote-insensitive.
    expect(resolvePhysicalFamily('Calibri Light, sans-serif')).toBe('Carlito, sans-serif');
    expect(resolvePhysicalFamily('"calibri light"')).toBe('Carlito');
    expect(resolvePrimaryPhysicalFamily('Calibri Light, sans-serif')).toBe('Carlito');
  });

  it('face-aware: resolveFace maps Calibri Light -> Carlito (category_fallback) when Carlito has the face', () => {
    const r = createFontResolver();
    expect(r.resolveFace('Calibri Light', R400, carlito)).toEqual({
      logicalFamily: 'Calibri Light',
      physicalFamily: 'Carlito',
      reason: 'category_fallback',
    });
  });

  it('paint/measure: resolvePhysicalFamilyForFace swaps the stack to Carlito (incl. a quoted primary)', () => {
    const r = createFontResolver();
    expect(r.resolvePhysicalFamilyForFace('Calibri Light, sans-serif', R400, carlito)).toBe('Carlito, sans-serif');
    // The normalized swap guard swaps a quoted/cased primary too (not a raw physical !== parts[0]).
    expect(r.resolvePhysicalFamilyForFace('"Calibri Light"', R400, carlito)).toBe('Carlito');
  });

  it('category target lacking the face falls through to as_requested (no swap, NOT fallback_face_absent)', () => {
    const r = createFontResolver();
    // Carlito provides no faces here: there is no metric substitute that could be "absent".
    expect(r.resolveFace('Calibri Light', R400, noFaces)).toEqual({
      logicalFamily: 'Calibri Light',
      physicalFamily: 'Calibri Light',
      reason: 'as_requested',
    });
    expect(r.resolvePhysicalFamilyForFace('Calibri Light, sans-serif', R400, noFaces)).toBe(
      'Calibri Light, sans-serif',
    );
  });

  it('a customer fonts.map still overrides the category fallback (custom_mapping wins)', () => {
    const r = createFontResolver();
    r.map('Calibri Light', 'Customer Light');
    expect(r.resolveFontFamily('Calibri Light')).toEqual({
      logicalFamily: 'Calibri Light',
      physicalFamily: 'Customer Light',
      reason: 'custom_mapping',
    });
  });
});

describe('embedded provider identity (mapEmbedded / clearEmbedded)', () => {
  const norm = (f: string) => f.replace(/^["']|["']$/g, '').toLowerCase();
  const PHYS = '__superdoc_embedded_7__0_Calibri';
  const registeredOf =
    (...families: string[]) =>
    (f: string) => {
      const set = new Set(families.map(norm));
      return set.has(norm(f));
    };
  const regular = { weight: '400', style: 'normal' } as const;

  it('quotes an embedded family with a numeric token while preserving its bare identity and fallbacks', () => {
    const resolver = createFontResolver();
    const physical = '__superdoc_embedded_7__0_Bauhaus 93';
    resolver.mapEmbedded('Bauhaus 93', physical);
    const hasFace = registeredOf(physical);
    expect(resolver.resolvePhysicalFamilyForFace('"Bauhaus 93", Arial, sans-serif', regular, hasFace)).toBe(
      `"${physical}", Arial, sans-serif`,
    );
    expect(resolver.resolveFace('Bauhaus 93', regular, hasFace)).toEqual({
      logicalFamily: 'Bauhaus 93',
      physicalFamily: physical,
      reason: 'registered_face',
    });
  });

  it('binds a logical family to a unique physical family (registered_face), beating the bundled clone', () => {
    const r = createFontResolver();
    r.mapEmbedded('Calibri', PHYS);
    const hasFace = registeredOf(PHYS, 'Carlito'); // embed physical + bundled clone both loadable
    expect(r.resolveFace('Calibri', regular, hasFace)).toEqual({
      logicalFamily: 'Calibri',
      physicalFamily: PHYS, // this document's OWN embedded font, not Carlito and not a shared "Calibri"
      reason: 'registered_face',
    });
    // Paint/measure swaps the primary to the unique physical family (fallbacks preserved).
    expect(r.resolvePhysicalFamilyForFace('Calibri, sans-serif', regular, hasFace)).toBe(`${PHYS}, sans-serif`);
  });

  it('beats a same-named registered face (the document embed wins over a global "Calibri")', () => {
    const r = createFontResolver();
    r.mapEmbedded('Calibri', PHYS);
    // Both the unique physical AND a bare "Calibri" (e.g. another document's fonts.add) are loadable.
    expect(r.resolveFace('Calibri', regular, registeredOf(PHYS, 'Calibri')).physicalFamily).toBe(PHYS);
  });

  it('is face-aware: a face the embed lacks falls through to the bundled substitute', () => {
    const r = createFontResolver();
    r.mapEmbedded('Calibri', PHYS);
    const hasFace = (f: string, w: '400' | '700', s: 'normal' | 'italic') => {
      if (norm(f) === norm(PHYS)) return w === '400' && s === 'normal'; // embed: Regular only
      if (norm(f) === 'carlito') return true; // bundled clone: every face
      return false;
    };
    expect(r.resolveFace('Calibri', { weight: '400', style: 'normal' }, hasFace)).toMatchObject({
      physicalFamily: PHYS,
      reason: 'registered_face',
    });
    // Bold: the embed lacks it -> bundled substitute, never the embed faux-styled.
    expect(r.resolveFace('Calibri', { weight: '700', style: 'normal' }, hasFace)).toEqual({
      logicalFamily: 'Calibri',
      physicalFamily: 'Carlito',
      reason: 'bundled_substitute',
    });
  });

  it('an explicit fonts.map override still wins over the embedded font', () => {
    const r = createFontResolver();
    r.mapEmbedded('Calibri', PHYS);
    r.map('Calibri', 'Tinos');
    expect(r.resolveFace('Calibri', regular, registeredOf(PHYS, 'Tinos'))).toMatchObject({
      physicalFamily: 'Tinos',
      reason: 'custom_mapping',
    });
  });

  it('clearEmbedded reverts the logical family to its bundled substitute', () => {
    const r = createFontResolver();
    r.mapEmbedded('Calibri', PHYS);
    const hasFace = registeredOf(PHYS, 'Carlito');
    expect(r.resolveFace('Calibri', regular, hasFace).reason).toBe('registered_face');
    r.clearEmbedded();
    expect(r.resolveFace('Calibri', regular, hasFace)).toMatchObject({
      physicalFamily: 'Carlito',
      reason: 'bundled_substitute',
    });
  });

  it('reset() drops embedded bindings as well as fonts.map overrides', () => {
    const r = createFontResolver();
    r.mapEmbedded('Calibri', PHYS);
    r.map('Georgia', 'Gelasio');
    r.reset();
    expect(r.resolveFace('Calibri', regular, registeredOf(PHYS, 'Carlito')).reason).toBe('bundled_substitute');
    expect(r.resolvePrimaryPhysicalFamily('Georgia')).toBe('Gelasio');
    expect(r.signature).toBe('');
  });

  it('folds embedded bindings into the signature (document-distinct; empty restores cache sharing)', () => {
    const r = createFontResolver();
    expect(r.signature).toBe('');
    r.mapEmbedded('Calibri', PHYS);
    expect(r.signature).not.toBe(''); // its physical is document-unique -> de-opts shared cache
    const other = createFontResolver();
    other.mapEmbedded('Calibri', '__superdoc_embedded_8__0_Calibri');
    expect(other.signature).not.toBe(r.signature); // two documents, same logical, distinct signatures
    r.clearEmbedded();
    expect(r.signature).toBe(''); // back to shared-default identity
  });

  it('keeps the existing signature format when there are no embedded bindings', () => {
    const a = createFontResolver();
    const b = createFontResolver();
    a.map('Georgia', 'Gelasio');
    b.map('Georgia', 'Gelasio');
    expect(a.signature).toBe(b.signature); // same mappings -> same signature (unchanged)
    expect(a.signature).not.toBe('');
  });
});
