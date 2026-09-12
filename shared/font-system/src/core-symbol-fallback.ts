import type { FontRegistry } from './registry';
import type { UnicodeCoverage, UnicodeRange } from './unicode-coverage';
import { textForUnicodeCoverage } from './unicode-coverage';

export const CORE_SYMBOL_FALLBACK_FAMILY = '__superdoc_core_symbols__';

// Separators use the normal font stack so lazy symbol loading cannot change their advances.
const CORE_SYMBOL_FALLBACK_CSS_RANGE =
  'U+23, U+2A, U+2022, U+20E2-20E3, U+21AF, U+21E6-21F0, U+21F3, U+2218-2219, U+2299, U+22C4-22C6, U+2316, U+2318, U+231A-231B, U+2324-2328, U+232B, U+237B, U+237D-237F, U+2394, U+23CE-23CF, U+23E9-23EA, U+23ED-23EF, U+23F1-2426, U+2440-244A, U+25A0-2609, U+260E-2612, U+2614-2623, U+2630-2637, U+263C, U+2654-2668, U+267F-268F, U+269E-26A1, U+26AA-26AC, U+26BD-26CD, U+26CF-26E1, U+2700-2704, U+2706-2709, U+270B-271C, U+2722-2727, U+2729-274B, U+274D, U+274F-2753, U+2756-2775, U+2794, U+2798-27AF, U+27B1-27BE, U+2800-28FF, U+2981, U+29BF, U+29EB, U+2B00-2B0D, U+2B12-2B2F, U+2B4D-2B73, U+2B76-2B95, U+2B97-2BFD, U+2BFF, U+4DC0-4DFF, U+FFF9-FFFB, U+10140-1018E, U+10190-1019C, U+101A0, U+101D0-101FD, U+102E0-102FB, U+10E60-10E7E, U+1D2C0-1D2D3, U+1D2E0-1D2F3, U+1D300-1D356, U+1D360-1D378, U+1F000-1F02B, U+1F030-1F093, U+1F0A0-1F0AE, U+1F0B1-1F0BF, U+1F0C1-1F0CF, U+1F0D1-1F0F5, U+1F10D-1F10F, U+1F16D-1F16F, U+1F1AD, U+1F30D-1F30F, U+1F315, U+1F31C, U+1F321-1F32C, U+1F336, U+1F378, U+1F37D, U+1F393-1F39F, U+1F3A7, U+1F3AC-1F3AE, U+1F3C2, U+1F3C4, U+1F3C6, U+1F3CA-1F3CE, U+1F3D4-1F3E0, U+1F3ED, U+1F3F1-1F3F3, U+1F3F5-1F3F7, U+1F408, U+1F415, U+1F41F, U+1F426, U+1F43F, U+1F441-1F442, U+1F446-1F449, U+1F44C-1F44E, U+1F453, U+1F46A, U+1F47D, U+1F4A3, U+1F4B0, U+1F4B3, U+1F4B9, U+1F4BB, U+1F4BF, U+1F4C8-1F4CB, U+1F4DA, U+1F4DF, U+1F4E4-1F4E6, U+1F4EA-1F4ED, U+1F4F7, U+1F4F9-1F4FB, U+1F4FD-1F4FE, U+1F503, U+1F507-1F50A, U+1F50D, U+1F512-1F513, U+1F53E-1F545, U+1F54A, U+1F550-1F579, U+1F57B-1F594, U+1F597-1F5A3, U+1F5A5-1F5FA, U+1F650-1F67F, U+1F687, U+1F68D, U+1F691, U+1F694, U+1F698, U+1F6AD, U+1F6B2, U+1F6B9-1F6BA, U+1F6BC, U+1F6C6-1F6CB, U+1F6CD-1F6CF, U+1F6D3-1F6D7, U+1F6E0-1F6EA, U+1F6F0-1F6F3, U+1F6F7-1F6FC, U+1F774-1F776, U+1F77B-1F7D9, U+1F7E0-1F7EB, U+1F800-1F80B, U+1F810-1F847, U+1F850-1F859, U+1F860-1F887, U+1F890-1F8AD, U+1F8B0-1F8B1, U+1F900-1F90B, U+1F93B, U+1F946, U+1FA00-1FA53, U+1FA60-1FA6D, U+1FA70-1FA74, U+1FA78-1FA7A, U+1FA80-1FA86, U+1FA90-1FAA8, U+1FAB0-1FAB6, U+1FAC0-1FAC2, U+1FAD0-1FAD6, U+1FB00-1FB92, U+1FB94-1FBCA, U+1FBF0-1FBF9';

function rangesFromCssUnicodeRange(value: string): UnicodeRange[] {
  return value.split(',').map((part) => {
    const [start, end] = part.trim().slice(2).split('-');
    return { start: Number.parseInt(start, 16), end: Number.parseInt(end ?? start, 16) };
  });
}

export const CORE_SYMBOL_FALLBACK_COVERAGE: UnicodeCoverage = Object.freeze({
  ranges: Object.freeze(rangesFromCssUnicodeRange(CORE_SYMBOL_FALLBACK_CSS_RANGE)),
  cssUnicodeRange: CORE_SYMBOL_FALLBACK_CSS_RANGE,
});

const coreSymbolAssetUrl = new URL('../assets/core/NotoSansSymbols2-Regular.woff2', import.meta.url).href;

/** Register the core provider; the load gate activates it only for text in its exact coverage. */
export function installCoreSymbolFallback(registry: FontRegistry): void {
  for (const weight of ['400', '700'] as const) {
    for (const style of ['normal', 'italic'] as const) {
      registry.register({
        family: CORE_SYMBOL_FALLBACK_FAMILY,
        source: `url(${JSON.stringify(coreSymbolAssetUrl)})`,
        descriptors: {
          weight,
          style,
          unicodeRange: CORE_SYMBOL_FALLBACK_CSS_RANGE,
        },
      });
    }
  }
}

/** Return the unique characters in `text` that the core provider can render. */
export function textForCoreSymbolFallback(text: string): string {
  return textForUnicodeCoverage(text, CORE_SYMBOL_FALLBACK_COVERAGE);
}
