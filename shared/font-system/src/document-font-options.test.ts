import { describe, it, expect } from 'vite-plus/test';
import {
  BASELINE_BUNDLED,
  FULLY_ACTIVE_BUNDLED,
  buildDocumentFontOptions,
  buildFontFamilyOptions,
  createBundledActivation,
  type FontFaceRequest,
  type FontLoadStatus,
  type FontRegistry,
  type UsedFace,
} from './index';

/** Face-aware fake registry: per-face load status + which faces are registered (hasFace). */
class FaceRegistry {
  readonly faceStatuses = new Map<string, FontLoadStatus>();
  readonly registered = new Set<string>();
  #key(family: string, weight: string, style: string): string {
    return `${family.toLowerCase()}|${weight}|${style}`;
  }
  getStatus(): FontLoadStatus {
    return 'unloaded';
  }
  getFaceStatus(req: FontFaceRequest): FontLoadStatus {
    return this.faceStatuses.get(this.#key(req.family, req.weight, req.style)) ?? 'unloaded';
  }
  hasFace(family: string, weight: '400' | '700', style: 'normal' | 'italic'): boolean {
    return this.registered.has(this.#key(family, weight, style));
  }
  setFace(family: string, weight: '400' | '700', style: 'normal' | 'italic', status: FontLoadStatus): void {
    this.registered.add(this.#key(family, weight, style));
    this.faceStatuses.set(this.#key(family, weight, style), status);
  }
  asRegistry(): FontRegistry {
    return this as unknown as FontRegistry;
  }
}

const regular = (logicalFamily: string): UsedFace => ({ logicalFamily, weight: '400', style: 'normal' });

/** A registry with the bundled clone pack loaded (so substitutes resolve) + one customer/embedded face. */
function loadedRegistry(): FaceRegistry {
  const reg = new FaceRegistry();
  const faces = [
    ['400', 'normal'],
    ['700', 'normal'],
    ['400', 'italic'],
    ['700', 'italic'],
  ] as const;
  for (const clone of ['Carlito', 'Caladea', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono']) {
    for (const [w, s] of faces) reg.setFace(clone, w, s, 'loaded'); // the bundled clones are four-face fonts
  }
  reg.setFace('BrandSans', '400', 'normal', 'loaded'); // a document-embedded / customer-added real face
  return reg;
}

describe('buildDocumentFontOptions (document-specific toolbar fonts)', () => {
  it('returns one plain option for each font the document uses', () => {
    const reg = loadedRegistry().asRegistry();
    const options = buildDocumentFontOptions(
      [
        regular('Calibri'),
        regular('Cambria'),
        regular('Calibri Light'),
        regular('Georgia'),
        regular('Aptos'),
        regular('Cambria Math'),
        regular('BrandSans'),
        regular('Wingdings'),
      ],
      reg,
    );
    expect(options.map((o) => o.logicalFamily)).toEqual([
      'Calibri',
      'Cambria',
      'Calibri Light',
      'Georgia',
      'Aptos',
      'Cambria Math',
      'BrandSans',
      'Wingdings',
    ]);
    expect(options.every((option) => !('status' in option))).toBe(true);
  });

  it('previews a bundled substitute through its physical clone, while preserving the logical name', () => {
    const reg = loadedRegistry().asRegistry();
    const [calibri] = buildDocumentFontOptions([regular('Calibri')], reg);
    expect(calibri).toMatchObject({ logicalFamily: 'Calibri', previewFamily: 'Carlito' });
  });

  it('dedupes a family used at multiple faces into one option (regular face represents it)', () => {
    const reg = loadedRegistry().asRegistry();
    const options = buildDocumentFontOptions(
      [
        { logicalFamily: 'Calibri', weight: '700', style: 'normal' },
        { logicalFamily: 'Calibri', weight: '400', style: 'normal' },
        { logicalFamily: 'Calibri', weight: '400', style: 'italic' },
      ],
      reg,
    );
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ logicalFamily: 'Calibri', previewFamily: 'Carlito' });
  });

  it('keeps the regular face as the preview representative when another used face is absent', () => {
    const reg = new FaceRegistry();
    reg.setFace('Carlito', '400', 'normal', 'loaded');
    const options = buildDocumentFontOptions(
      [
        { logicalFamily: 'Calibri', weight: '400', style: 'normal' },
        { logicalFamily: 'Calibri', weight: '700', style: 'normal' },
      ],
      reg.asRegistry(),
    );
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ logicalFamily: 'Calibri', previewFamily: 'Carlito' });
  });
});

describe('buildFontFamilyOptions (custom UI font picker rows)', () => {
  const documentOptions = [
    { logicalFamily: 'Aptos', previewFamily: 'Aptos' },
    { logicalFamily: 'Bangla MN', previewFamily: 'Bangla MN' },
    { logicalFamily: 'Calibri', previewFamily: 'Carlito' },
    { logicalFamily: 'Apple Chancery', previewFamily: 'Apple Chancery' },
  ];

  it('with no pack configured: the baseline plus document fonts, alphabetical, no status field', () => {
    const options = buildFontFamilyOptions(documentOptions);
    expect(options.map((option) => option.label)).toEqual([
      'Apple Chancery',
      'Aptos',
      'Arial',
      'Bangla MN',
      'Calibri',
      'Courier New',
      'Times New Roman',
    ]);
    // BASELINE_BUNDLED is the explicit form of the same default.
    expect(buildFontFamilyOptions(documentOptions, BASELINE_BUNDLED).map((o) => o.label)).toEqual(
      options.map((o) => o.label),
    );
    expect(options.filter((option) => option.label === 'Calibri')).toHaveLength(1);
    expect(options.every((option) => !('status' in option))).toBe(true);
  });

  it('baseline built-in rows preview in the logical family; configured rows preview in the physical clone', () => {
    // In baseline the physical clone (e.g. Liberation Serif) is neither registered nor served, so the
    // row must preview in the logical family that actually renders - not the clone.
    const baselineTnr = buildFontFamilyOptions([], BASELINE_BUNDLED).find((o) => o.label === 'Times New Roman');
    expect(baselineTnr?.previewFamily).toBe('Times New Roman');
    // With the pack configured the clone is served, so the preview uses the physical clone.
    const richTnr = buildFontFamilyOptions([], FULLY_ACTIVE_BUNDLED).find((o) => o.label === 'Times New Roman');
    expect(richTnr?.previewFamily).not.toBe('Times New Roman');
  });

  it('with the pack configured: the full built-in set plus document fonts', () => {
    const options = buildFontFamilyOptions(documentOptions, FULLY_ACTIVE_BUNDLED);
    expect(options.map((option) => option.label)).toEqual([
      'Apple Chancery',
      'Aptos',
      'Arial',
      'Arial Black',
      'Arial Narrow',
      'Bangla MN',
      'Baskerville Old Face',
      'Bookman Old Style',
      'Brush Script MT',
      'Calibri',
      'Century',
      'Century Gothic',
      'Comic Sans MS',
      'Cooper Black',
      'Courier New',
      'Garamond',
      'Georgia',
      'Gill Sans MT Condensed',
      'Helvetica',
      'Lucida Console',
      'Segoe UI',
      'Tahoma',
      'Times New Roman',
      'Trebuchet MS',
      'Verdana',
    ]);
    expect(options.filter((option) => option.label === 'Calibri')).toHaveLength(1);
  });

  it('uses the logical family as the apply value and previewFamily only for row rendering', () => {
    const options = buildFontFamilyOptions([{ logicalFamily: 'Calibri', previewFamily: 'Carlito' }]);
    const calibri = options.find((option) => option.label === 'Calibri');
    expect(calibri).toMatchObject({ label: 'Calibri', value: 'Calibri', previewFamily: 'Carlito' });
  });

  it('canonicalizes a document CSS-stack family to its first family and dedupes against the baseline', () => {
    // A document run can carry a fallback stack as its family. The picker must advertise the
    // logical font ("Arial"), not the stack, and must not list both "Arial" and "Arial, sans-serif".
    const options = buildFontFamilyOptions([
      { logicalFamily: 'Arial, sans-serif', previewFamily: 'Arial' },
      { logicalFamily: '"Times New Roman", serif', previewFamily: 'Times New Roman' },
    ]);
    expect(options.map((o) => o.label)).toEqual(['Arial', 'Courier New', 'Times New Roman']);
    expect(options.filter((o) => o.label === 'Arial')).toHaveLength(1);
    expect(options.filter((o) => o.label === 'Times New Roman')).toHaveLength(1);
    // The applied value is the canonical family, never the raw stack.
    expect(options.find((o) => o.label === 'Arial')).toMatchObject({ value: 'Arial' });
    expect(options.some((o) => o.value.includes(','))).toBe(false);
  });

  it('lists a document stack font absent from the baseline under its canonical first family', () => {
    const options = buildFontFamilyOptions([{ logicalFamily: 'Brand Sans, sans-serif', previewFamily: 'Brand Sans' }]);
    const brand = options.find((o) => o.label === 'Brand Sans');
    expect(brand).toMatchObject({ label: 'Brand Sans', value: 'Brand Sans', previewFamily: 'Brand Sans' });
    expect(options.some((o) => o.label === 'Brand Sans, sans-serif')).toBe(false);
  });

  // The font-config matrix (SD-3515): the picker list each scenario advertises. Baseline and the
  // full pack are covered above; these pin the include / exclude / custom + full scenarios. Every
  // scenario must stay free of duplicate canonical families and raw fallback-stack labels.
  const noStacksNoDupes = (options: ReturnType<typeof buildFontFamilyOptions>): void => {
    expect(options.some((o) => o.label.includes(',') || o.value.includes(','))).toBe(false);
    const labels = options.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
  };

  it('include: advertises exactly the listed bundled families (the include list is exhaustive)', () => {
    const activation = createBundledActivation({ packConfigured: true, include: ['Georgia', 'Verdana'] });
    const options = buildFontFamilyOptions([], activation);
    expect(options.map((o) => o.label)).toEqual(['Georgia', 'Verdana']);
    // A bundled family not in the include list is absent (incl. the browser-safe baseline names,
    // which are bundled families gated by the same predicate).
    expect(options.some((o) => o.label === 'Tahoma')).toBe(false);
    expect(options.some((o) => o.label === 'Arial')).toBe(false);
    noStacksNoDupes(options);
  });

  it('exclude: drops the listed families and keeps the rest of the pack', () => {
    const activation = createBundledActivation({ packConfigured: true, exclude: ['Georgia', 'Verdana'] });
    const options = buildFontFamilyOptions([], activation);
    const full = buildFontFamilyOptions([], FULLY_ACTIVE_BUNDLED);
    expect(options.some((o) => o.label === 'Georgia')).toBe(false);
    expect(options.some((o) => o.label === 'Verdana')).toBe(false);
    expect(options.some((o) => o.label === 'Tahoma')).toBe(true);
    expect(options).toHaveLength(full.length - 2);
    noStacksNoDupes(options);
  });

  it('full + custom: both bundled families and the document custom font appear, deduped and clean', () => {
    const options = buildFontFamilyOptions(
      [{ logicalFamily: 'Acme Custom', previewFamily: 'Acme Custom' }],
      FULLY_ACTIVE_BUNDLED,
    );
    expect(options.some((o) => o.label === 'Acme Custom')).toBe(true);
    expect(options.some((o) => o.label === 'Verdana')).toBe(true);
    expect(options.find((o) => o.label === 'Acme Custom')).toMatchObject({ value: 'Acme Custom' });
    noStacksNoDupes(options);
  });

  it('preserves an internal comma in a quoted first family (does not truncate at the comma)', () => {
    const options = buildFontFamilyOptions([
      { logicalFamily: '"Acme, Inc Sans", sans-serif', previewFamily: 'Acme, Inc Sans' },
      { logicalFamily: "'Foo, Bar', serif", previewFamily: 'Foo, Bar' },
    ]);
    const acme = options.find((o) => o.label === 'Acme, Inc Sans');
    expect(acme).toMatchObject({ label: 'Acme, Inc Sans', value: 'Acme, Inc Sans' });
    expect(options.some((o) => o.label === 'Foo, Bar')).toBe(true);
    // The leading family is taken whole, never split to "Acme" / "Foo".
    expect(options.some((o) => o.label === 'Acme')).toBe(false);
    expect(options.some((o) => o.label === 'Foo')).toBe(false);
  });
});

describe('SD-5389 document option generic fallback', () => {
  it.each([
    ['Aptos Display', 'sans-serif'],
    ['Cambria', 'serif'],
    ['Consolas', 'monospace'],
    ['SD Unknown Missing', 'sans-serif'],
    ['SD Swiss Missing, Arial, sans-serif', 'sans-serif'],
    ['SD Roman Missing, Times New Roman, serif', 'serif'],
    ['SD Modern Missing, Courier New, monospace', 'monospace'],
    ['SD Fixed Missing, monospace', 'monospace'],
    ['"serif", sans-serif', 'sans-serif'],
    ['SD Missing, cursive', 'cursive'],
    ['SD Missing, fantasy', 'fantasy'],
    ['SD Missing, system-ui', 'system-ui'],
    ['SD Missing, serif, monospace', 'serif'],
    ['SD Missing, Another Missing', null],
  ])('exposes the renderer generic for %s without changing existing fields', (logicalFamily, genericFamily) => {
    const [option] = buildDocumentFontOptions([regular(logicalFamily)], new FaceRegistry().asRegistry());
    expect(option.logicalFamily).toBe(logicalFamily);
    const expectedPreview = logicalFamily
      .split(',')[0]
      .trim()
      .replace(/^["']|["']$/g, '');
    expect(option.previewFamily).toBe(expectedPreview);
    expect((option as typeof option & { genericFamily?: string | null }).genericFamily).toBe(genericFamily);
  });

  it('keeps the logical classification when the physical preview is substituted', () => {
    const [option] = buildDocumentFontOptions([regular('Cambria')], loadedRegistry().asRegistry());
    expect(option).toMatchObject({ logicalFamily: 'Cambria', previewFamily: 'Caladea', genericFamily: 'serif' });
  });
});
