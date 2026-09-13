/**
 * `@superdoc/font-system` - runtime font registry, load-state, and logical->physical
 * resolution shared across the SuperDoc rendering pipeline.
 *
 * Consumed by measurement (`@superdoc/measuring-dom`), paint (`painters/dom`),
 * and editor runtimes so all layers agree on which
 * physical face is used and whether it is ready. Separate from
 * `@superdoc/font-utils` (CSS fallback-string composition only).
 *
 * Surfaces: the load-state contract + `FontRegistry` (a registry per `FontFaceSet`);
 * the resolver (`resolveFontFamily`/`resolvePhysicalFamily`, e.g. Calibri->Carlito);
 * and a `fontConfigVersion` epoch that reuse signatures fold in so a font change busts
 * stale measure/paint reuse. The bundled substitute pack ships from the `./bundled`
 * subpath; the public DX surface (T7) builds on `FontRegistry.register`.
 */
export type {
  FontLoadStatus,
  FontFaceSource,
  FontFaceDescriptor,
  RegisteredFace,
  RegisterFaceResult,
  FontLoadResult,
  FontLoadSummary,
  FontFaceRequest,
  FontFaceLoadResult,
  FontAssetUrlContext,
  FontAssetUrlResolver,
  RequiredFace,
} from './types';
export { SETTLED_STATUSES, isSettled } from './types';

export type {
  FontResolution,
  FontResolutionReason,
  FaceKey,
  HasFace,
  FontMeasureCapabilities,
  FontMeasureContext,
  FontMeasureFace,
  ResolvePhysicalFamily,
  ResolveNaturalLineMultiplier,
} from './resolver';
export { FontResolver, createFontResolver, insertFontFamilyBeforeGeneric } from './resolver';
export {
  resolveFontFamily,
  resolvePhysicalFamily,
  resolvePrimaryPhysicalFamily,
  resolvePhysicalFamilies,
  resolveFace,
  DEFAULT_FONT_MEASURE_CONTEXT,
} from './resolver';

export { getFontConfigVersion, bumpFontConfigVersion, __resetFontConfigVersion } from './epoch';

// Per-document bundled-font activation (config-presence gate + curation). The resolver and offerings
// consume it; the editor's runtime paths derive it via `deriveBundledActivationForConfig` (which
// sanitizes raw `fonts.bundled`), built on the lower-level `deriveBundledActivation`.
export type {
  BundledFontSelection,
  BundledActivation,
  BundledActivationInput,
  FontAssetConfigLike,
} from './activation';
export { createBundledActivation, deriveBundledActivation, FULLY_ACTIVE_BUNDLED, BASELINE_BUNDLED } from './activation';

// The bundled-asset base setter is also exported here (not only the ./bundled subpath) so
// the CDN entry can resolve it through the bare `@superdoc/font-system` specifier.
export {
  setBundledFontAssetBase,
  getBundledFontAssetBase,
  DEFAULT_BUNDLED_FONT_BASE,
  markBundledPackPresent,
  isBundledPackPresent,
  __resetBundledPackPresent,
} from './bundled';

export type { FontResolutionRecord, ResolvedFontEvidence, UsedFace } from './report';
export { buildFontReport, buildFaceReport } from './report';

export type { EmbeddingPolicy } from './os2';
export { parseEmbeddingPolicy } from './os2';

export type { SfntNaturalLineMetrics } from './natural-line-metrics';
export { parseSfntNaturalLineMetrics } from './natural-line-metrics';

export type { UnicodeCoverage, UnicodeRange } from './unicode-coverage';
export { parseUnicodeCoverage, textForUnicodeCoverage, unicodeCoverageIncludes } from './unicode-coverage';

export {
  CORE_SYMBOL_FALLBACK_COVERAGE,
  CORE_SYMBOL_FALLBACK_FAMILY,
  installCoreSymbolFallback,
  textForCoreSymbolFallback,
} from './core-symbol-fallback';

export type { FontSetLike, FontFaceLike, FontFaceCtor, FontRegistryOptions, OwnedFaceDescriptor } from './registry';
export {
  FontRegistry,
  getFontRegistryFor,
  getDefaultFontRegistry,
  DEFAULT_FONT_LOAD_TIMEOUT_MS,
  __resetDefaultFontRegistry,
} from './registry';

export type { FontOffering, OfferingClass, FontGeneric } from './font-offerings';
export {
  FONT_OFFERINGS,
  getBuiltInToolbarFontOfferings,
  getDefaultFontOfferings,
  getDefaultFontFamilyOptions,
  fontOfferingStack,
  fontOfferingRenderStack,
  warnUnknownBundledSelection,
  getBundledFamilyNames,
  sanitizeBundledSelection,
  deriveBundledActivationForConfig,
} from './font-offerings';

export type { DocumentFontOption, FontFamilyOption } from './document-font-options';
export { buildDocumentFontOptions, buildFontFamilyOptions } from './document-font-options';

export type {
  FaceSlot as FontFaceSlot,
  GlyphException,
  SubstitutePolicyAction,
  SubstituteVerdict,
} from './substitution-evidence';
