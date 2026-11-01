import { describe, expect, it } from 'vite-plus/test';
import { TOOLBAR_FONTS, composeToolbarFontOptions, mapFontFamilyOptionsToToolbar } from './constants.js';

describe('mapFontFamilyOptionsToToolbar', () => {
  it('maps host font-family options onto the toolbar option shape', () => {
    const options = [
      { label: 'Calibri', value: 'Calibri', previewFamily: 'Carlito' },
      { label: 'Garamond', value: 'Garamond', previewFamily: 'Cardo' },
    ];

    expect(mapFontFamilyOptionsToToolbar(options)).toEqual([
      {
        label: 'Calibri',
        key: 'Calibri',
        props: { style: { fontFamily: 'Carlito' }, 'data-item': 'btn-fontFamily-option' },
      },
      {
        label: 'Garamond',
        key: 'Garamond',
        props: { style: { fontFamily: 'Cardo' }, 'data-item': 'btn-fontFamily-option' },
      },
    ]);
  });

  it('returns undefined for an empty or missing list so the caller keeps its TOOLBAR_FONTS fallback', () => {
    expect(mapFontFamilyOptionsToToolbar([])).toBeUndefined();
    expect(mapFontFamilyOptionsToToolbar(undefined)).toBeUndefined();
  });

  it('falls back to the label for the preview family when previewFamily is empty', () => {
    const [option] = mapFontFamilyOptionsToToolbar([{ label: 'Aptos', value: 'Aptos', previewFamily: '' }]);
    expect(option.props.style.fontFamily).toBe('Aptos');
  });
});

describe('toolbar font row shape', () => {
  // Both renderers obtain per-row DOM attributes and styling through
  // `option.props` (`ToolbarComboBox.vue:559`, `ToolbarDropdown.vue:420`);
  // neither reads a top-level `fontWeight`. They do read other top-level
  // members — `label` is applied to the selection, `key` is the selection
  // identity, and the dropdown also reads `type`, `icon`, `render`, and more —
  // so this is not a claim about everything a renderer touches. It pins what
  // these three producers emit, which is the canonical `ToolbarFontOption`
  // shape: a style member outside `props` would be dead weight in the row and
  // would contradict a public type that declares no such field.
  //
  // Asserted against all three rather than one: the whole-object `toEqual`
  // above covers `mapFontFamilyOptionsToToolbar`, and before this nothing
  // pinned what `TOOLBAR_FONTS` and `composeToolbarFontOptions` emit.
  const CANONICAL_ROW_KEYS = ['key', 'label', 'props'];

  const rowsFromCompose = composeToolbarFontOptions(
    [{ logicalFamily: 'Inter', previewFamily: 'Inter, sans-serif' }],
    undefined,
  );

  it.each([
    ['TOOLBAR_FONTS', TOOLBAR_FONTS],
    ['composeToolbarFontOptions', rowsFromCompose],
    [
      'mapFontFamilyOptionsToToolbar',
      mapFontFamilyOptionsToToolbar([{ label: 'Calibri', value: 'Calibri', previewFamily: 'Carlito' }]),
    ],
  ])('%s emits the canonical toolbar font-row key set', (_name, rows) => {
    expect(rows?.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(CANONICAL_ROW_KEYS);
    }
  });
});
