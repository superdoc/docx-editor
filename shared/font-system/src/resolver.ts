/**
 * Logical -> physical font resolution.
 *
 * A document refers to a font by its *logical* family - the name Word wrote, e.g.
 * "Calibri". The browser may not have that font (it is proprietary), so SuperDoc
 * renders a reviewed *physical* fallback, such as metric-compatible Carlito for Calibri. The
 * logical name stays the source of truth (toolbar, export); only measurement and paint use the
 * physical family, and they MUST use the same one or text is measured in one font and painted in
 * another.
 *
 * The value reaching measure and paint is a CSS font-family *stack* the layout
 * builds via `toCssFontFamily`, e.g. "Calibri, sans-serif" - so resolution applies
 * to the PRIMARY family and keeps the remaining fallbacks ("Carlito, sans-serif").
 *
 * Resolution is a {@link FontResolver} INSTANCE, not a global: each document gets its
 * own so two editors on one page can map the same logical family differently (a
 * customer `fonts.map`) without leaking across documents - the same per-document
 * isolation the registry already has per `FontFaceSet`. Every instance is seeded from DocFonts
 * evidence gated by the local bundled asset manifest. The module-level `resolve*` functions delegate
 * to a shared default instance for callers that have no document context (and for backward
 * compatibility).
 */

import { getFallbackDecisionForFace, getRenderableFallback } from '@docfonts/fallbacks';

import { type BundledActivation, FULLY_ACTIVE_BUNDLED } from './activation';
import { BUNDLED_MANIFEST } from './bundled-manifest';
import { SUBSTITUTION_EVIDENCE, type FaceSlot } from './substitution-evidence';

export type FontResolutionReason =
  /** No substitute is known; the requested family is used as-is. */
  | 'as_requested'
  /**
   * A real face is registered for this weight/style, either under the logical family itself
   * (customer `fonts.add`) or under a document-unique embedded-font alias. SuperDoc intentionally
   * renders the registered provider and bypasses bundled substitutes. Higher precedence than
   * `bundled_substitute`, lower than an explicit `custom_mapping`. Only the face-aware path yields
   * this.
   */
  | 'registered_face'
  /** Replaced by a bundled metric-compatible clone. */
  | 'bundled_substitute'
  /** Replaced by a runtime mapping set on this document's resolver (customer `fonts.map`). */
  | 'custom_mapping'
  /**
   * Replaced by the closest bundled FAMILY, but NOT a metric-compatible clone: advances reflow and/or
   * the weight differs (e.g. Calibri Light -> Carlito, which has no Light face, so it renders at Regular
   * and reflows ~6.6%). A useful family fallback, never reported as metric-safe. Lower precedence than
   * `bundled_substitute`; sourced from docfonts rows with `policyAction: 'category_fallback'`.
   */
  | 'category_fallback'
  /**
   * A substitute is known for the family but does NOT provide the requested face (weight/style),
   * so the family passes through UNsubstituted rather than faux-styling the substitute's Regular
   * onto a face it lacks. Reported non-metric. Only the face-aware path (`resolveFace` /
   * `resolvePhysicalFamilyForFace`) yields this; the family-only methods never do.
   */
  | 'fallback_face_absent';

export interface FontResolution {
  /** The family the document asked for (preserved for toolbar/export). */
  logicalFamily: string;
  /** The bare physical family that is actually loaded, measured, and painted. */
  physicalFamily: string;
  reason: FontResolutionReason;
  /**
   * The real registered face used for loading when the requested face is synthetic. Omitted when the
   * requested face itself is the source face.
   */
  sourceFace?: FaceKey;
}

/** A specific face within a family: the weight/style axis a run renders at. */
export interface FaceKey {
  weight: '400' | '700';
  style: 'normal' | 'italic';
}

/**
 * Face-availability oracle: does the PHYSICAL family actually provide this face? Backed by the
 * registry (bundled faces registered by `installBundledSubstitutes` + customer `fonts.add()`
 * faces). Injected rather than imported so font-system has no registry import cycle and each caller
 * passes its own document's registry lookup.
 */
export type HasFace = (physicalFamily: string, weight: '400' | '700', style: 'normal' | 'italic') => boolean;

/** Normalize a family name for lookup: trim, strip surrounding quotes, lowercase. */
function normalizeFamilyKey(family: string): string {
  return family
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();
}

/** Deterministically sort [key, value] pairs by key, for a stable, order-independent signature. */
function sortPairs(pairs: Array<[string, string]>): Array<[string, string]> {
  return pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Asset gate: a docfonts fallback activates only when SuperDoc actually ships its physical clone. The
 * evidence registry carries more substitutes than the bundled pack covers (e.g. Arial Rounded MT Bold), so
 * `canRenderFamily` keeps an un-shipped candidate OUT of the resolver until its `.woff2` lands. The
 * predicate checks the SUBSTITUTE (physical) family against `bundled-manifest`, matching the package's
 * `getRenderableFallback` contract.
 */
const bundledFamilies: ReadonlySet<string> = new Set(BUNDLED_MANIFEST.map((f) => f.family));
const canRenderFamily = (family: string): boolean => bundledFamilies.has(family);

function faceSlotFor({ weight, style }: FaceKey): FaceSlot {
  const bold = weight === '700';
  const italic = style === 'italic';
  if (bold && italic) return 'boldItalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'regular';
}

function faceKeyForSlot(slot: FaceSlot): FaceKey {
  switch (slot) {
    case 'bold':
      return { weight: '700', style: 'normal' };
    case 'italic':
      return { weight: '400', style: 'italic' };
    case 'boldItalic':
      return { weight: '700', style: 'italic' };
    case 'regular':
      return { weight: '400', style: 'normal' };
  }
}

function reasonForFallback(policyAction: 'substitute' | 'category_fallback'): FontResolutionReason {
  return policyAction === 'category_fallback' ? 'category_fallback' : 'bundled_substitute';
}

type FaceResolution = { physical: string; reason: FontResolutionReason; sourceFace?: FaceKey };

function resolveDocfontsFace(primary: string, face: FaceKey, hasFace: HasFace): FaceResolution | null {
  const decision = getFallbackDecisionForFace(primary, faceSlotFor(face), { canRenderFamily });
  if (decision.kind === 'face_missing') {
    return { physical: primary, reason: 'fallback_face_absent' };
  }
  if (decision.kind !== 'fallback') return null;
  const fallback = decision.fallback;
  if (fallback.policyAction !== 'substitute' && fallback.policyAction !== 'category_fallback') return null;
  if (hasFace(fallback.substituteFamily, face.weight, face.style)) {
    return {
      physical: fallback.substituteFamily,
      reason: reasonForFallback(fallback.policyAction),
    };
  }
  const sourceFace = fallback.faceSource?.kind === 'synthetic' ? faceKeyForSlot(fallback.faceSource.from) : face;
  if (!hasFace(fallback.substituteFamily, sourceFace.weight, sourceFace.style)) {
    return fallback.policyAction === 'substitute' ? { physical: primary, reason: 'fallback_face_absent' } : null;
  }
  const sourceDiffers = sourceFace.weight !== face.weight || sourceFace.style !== face.style;
  return {
    physical: fallback.substituteFamily,
    reason: reasonForFallback(fallback.policyAction),
    ...(sourceDiffers ? { sourceFace } : {}),
  };
}

/**
 * Logical (normalized) -> physical family, DERIVED from the docfonts substitution registry: every row
 * whose ASSET-GATED fallback (`getRenderableFallback`) is a renderable `substitute`. docfonts owns the
 * decision (evidence + policy + asset-safety); SuperDoc keeps key normalization (`normalizeFamilyKey`)
 * authoritative so resolver lookups land on the same keys.
 *
 * The inclusion predicate is policyAction, NOT verdict: a QUALIFIED substitute - e.g. Cambria ->
 * Caladea, top-level `visual_only` because Bold Italic's U+0060 advance reflows - is still the
 * recommended substitute and stays mapped. Verdict drives how fidelity is REPORTED (a later pass),
 * never whether SuperDoc substitutes. Gate status (e.g. Helvetica's stale `ship: fail`) is diagnostic,
 * never an inclusion input. The asset gate guarantees every mapped physical ships in the bundled pack.
 */
function deriveBundledSubstitutes(): Readonly<Record<string, string>> {
  const substitutes: Record<string, string> = {};
  for (const row of SUBSTITUTION_EVIDENCE) {
    const fallback = getRenderableFallback(row.logicalFamily, { canRenderFamily });
    if (fallback?.policyAction === 'substitute') {
      substitutes[normalizeFamilyKey(row.logicalFamily)] = fallback.substituteFamily;
    }
  }
  return Object.freeze(substitutes);
}

const BUNDLED_SUBSTITUTES: Readonly<Record<string, string>> = deriveBundledSubstitutes();

/**
 * Logical (normalized) -> non-metric family fallback, DERIVED from the docfonts rows whose asset-gated
 * fallback is a `category_fallback`. These carry the right letterforms but are NOT metric clones (they
 * reflow and/or differ in weight, e.g. Calibri Light -> Carlito), so they resolve with reason
 * `category_fallback`, never `bundled_substitute`. A SEPARATE map and reason keep a lower-fidelity
 * fallback from being mistaken for a clean clone. Same asset gate as {@link deriveBundledSubstitutes};
 * the two partition the renderable fallbacks by `policyAction` (an un-bundled category target, e.g.
 * Arial Rounded MT Bold -> Ubuntu, stays inert).
 */
function deriveCategoryFallbacks(): Readonly<Record<string, string>> {
  const fallbacks: Record<string, string> = {};
  for (const row of SUBSTITUTION_EVIDENCE) {
    const fallback = getRenderableFallback(row.logicalFamily, { canRenderFamily });
    if (fallback?.policyAction === 'category_fallback') {
      fallbacks[normalizeFamilyKey(row.logicalFamily)] = fallback.substituteFamily;
    }
  }
  return Object.freeze(fallbacks);
}

const CATEGORY_FALLBACKS: Readonly<Record<string, string>> = deriveCategoryFallbacks();

/**
 * Strip surrounding quotes from a family name, PRESERVING case, so a STRUCTURED resolution returns a
 * bare load/report family - a quoted CSS primary like `"Calibri"` becomes `Calibri`. Without this, a
 * quoted family that resolves to `registered_face` returns `"Calibri"`, which the load/preload probe
 * (`faceProbe` -> `quoteFamily`) quotes AGAIN, so the browser probes a literal `"Calibri"` and never
 * matches the registered face (a false fallback + reflow). Distinct from {@link normalizeFamilyKey},
 * which lowercases for KEYING; here the rendered/reported family must keep its case. The CSS paint
 * paths intentionally keep the quotes (a quoted stack is valid CSS).
 */
function stripFamilyQuotes(family: string): string {
  return family.trim().replace(/^["']|["']$/g, '');
}

/** Split a CSS font-family value into trimmed, non-empty families (primary first). */
function splitStack(cssFontFamily: string): string[] {
  return cssFontFamily
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const CSS_GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

/** Insert a physical fallback before CSS generic families without changing the primary family. */
export function insertFontFamilyBeforeGeneric(cssFontFamily: string, fallbackFamily: string): string {
  const parts = splitStack(cssFontFamily);
  const fallback = stripFamilyQuotes(fallbackFamily);
  if (parts.length === 0 || !fallback) return cssFontFamily;
  if (parts.some((part) => normalizeFamilyKey(part) === normalizeFamilyKey(fallback))) return cssFontFamily;
  const insertion = parts.findIndex((part) => CSS_GENERIC_FAMILIES.has(normalizeFamilyKey(part)));
  const quotedFallback = `"${fallback.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (insertion < 0) return [...parts, quotedFallback].join(', ');
  return [...parts.slice(0, insertion), quotedFallback, ...parts.slice(insertion)].join(', ');
}

/**
 * Per-document logical -> physical font resolver. Seeded with bundled DocFonts fallbacks;
 * also holds per-instance runtime overrides (a customer `fonts.map`). Because each
 * document owns its instance, two documents can map the same logical family to different
 * physical families without interfering. Its {@link signature} (NOT the numeric
 * {@link version}) is the identity measure-cache keys and paint reuse signatures must fold in,
 * so two documents at the same version with different mappings never collide.
 */
export class FontResolver {
  /** Normalized logical family -> physical family. Takes precedence over the bundled map. */
  readonly #overrides = new Map<string, string>();
  /**
   * Normalized logical family -> this document's UNIQUE physical render family for its embedded font
   * (e.g. `calibri` -> `__superdoc_embedded_3__Calibri`). Document-owned render identity: the browser's
   * FontFaceSet is shared per page, so two documents that both embed "Calibri" must render under
   * distinct physical families or one document would paint with the other's (subset) bytes. Resolves
   * to `registered_face` and beats a same-named customer `fonts.add` face; the logical name is kept for
   * export/report. Set by the document font controller, which also registers the face under the same
   * physical name; cleared on a document swap / teardown.
   */
  readonly #embedded = new Map<string, string>();
  #version = 0;
  /** Memoized {@link signature}; null = stale, recomputed on next read. Invalidated on every mutation. */
  #cachedSignature: string | null = null;
  /**
   * This document's bundled-font activation: which bundled families it may substitute to and
   * advertise (config-presence + optional curation). Set once at config time via {@link setActivation}
   * (the editor's `fonts` config is stable across document swaps), then effectively constant. Folded
   * into {@link signature} so a no-pack / curated document never reuses a full-pack document's measure
   * cache. Defaults to fully active, so the module-level resolver and any `createFontResolver()` with
   * no activation keep the prior global substitution behavior.
   */
  #activation: BundledActivation;

  constructor(activation: BundledActivation = FULLY_ACTIVE_BUNDLED) {
    this.#activation = activation;
  }

  /**
   * Apply this document's bundled-font activation, derived from the editor's `fonts` config.
   * Config-time only: the document font controller calls this before the first measure. Busts the
   * cached {@link signature} (and bumps {@link version}) so the new activation is reflected in both
   * resolution and the measure-cache key; a no-op when the activation signature is unchanged, so
   * re-applying the same config on a document swap neither reflows nor drops the cache.
   */
  setActivation(activation: BundledActivation): void {
    if (this.#activation.signature === activation.signature) {
      this.#activation = activation;
      return;
    }
    this.#activation = activation;
    this.#version += 1;
    this.#cachedSignature = null;
  }

  /**
   * Map a logical family to a physical render family for this document, overriding the
   * bundled default (e.g. "Georgia" -> "Gelasio", or a customer family -> their font).
   * The physical family must be one the registry can load.
   *
   * A self-map (`map('Georgia', 'Georgia')`, normalized) is the absence of an override and is dropped.
   * Mapping to the bundled clone (`map('Calibri', 'Carlito')`) is NOT a no-op: it is stored as an
   * explicit pin so it outranks a registered real face for that family (`custom_mapping` > `registered_face`).
   */
  map(logicalFamily: string, physicalFamily: string): void {
    const key = normalizeFamilyKey(logicalFamily);
    // The physical name is the bare family the registry loads and CSS renders, so trim
    // surrounding whitespace (" Gelasio " and "Gelasio" must be one mapping, not two).
    const physical = physicalFamily?.trim();
    if (!key || !physical) return;
    if (this.#overrides.get(key) === physical) return;
    // Mapping a family to its OWN name (identity, e.g. `map({ Georgia: 'Georgia' })`) is the ABSENCE
    // of an override, not one to record: drop any existing override and revert to the default. Use
    // `unmap()` to revert other mappings.
    //
    // Mapping to the bundled CLONE (e.g. `map({ Calibri: 'Carlito' })`) is NOT treated as a no-op,
    // unlike before provider precedence. A registered real Calibri now outranks the clone via
    // `registered_face`, so an explicit pin to the clone is semantically distinct from the default and
    // must be STORED as a real override - else `custom_mapping` could never beat a registered face and
    // the pin would be silently ignored. The cost is a non-empty signature (this document stops sharing
    // the measure cache with default documents), accepted for an explicit pin.
    //
    // Identity is compared with the resolver's family normalization (quote-strip + lowercase), so a
    // quoted/cased self-map (`map('"Georgia"', 'Georgia')`) is still recognized as identity and dropped,
    // not stored as a spurious override.
    if (key === normalizeFamilyKey(physical)) {
      if (this.#overrides.delete(key)) {
        this.#version += 1;
        this.#cachedSignature = null;
      }
      return;
    }
    this.#overrides.set(key, physical);
    this.#version += 1;
    this.#cachedSignature = null;
  }

  /** Remove a runtime mapping; the family reverts to its bundled default (or identity). */
  unmap(logicalFamily: string): void {
    if (this.#overrides.delete(normalizeFamilyKey(logicalFamily))) {
      this.#version += 1;
      this.#cachedSignature = null;
    }
  }

  /**
   * Bind a logical family to this document's UNIQUE physical render family for its embedded font, so
   * the face-aware ladder resolves the logical family to that physical name with reason
   * `registered_face`. The caller (the document font controller) must register the face under the same
   * physical name. Render-only: export keeps the logical family. The physical name must be unique to
   * this document so a shared FontFaceSet cannot cross-render another document's embedded bytes.
   */
  mapEmbedded(logicalFamily: string, physicalFamily: string): void {
    const key = normalizeFamilyKey(logicalFamily);
    const physical = physicalFamily?.trim();
    if (!key || !physical) return;
    if (this.#embedded.get(key) === physical) return;
    this.#embedded.set(key, physical);
    this.#version += 1;
    this.#cachedSignature = null;
  }

  /** Drop all embedded-family bindings (a document swap / teardown releases this document's embedded
   *  fonts). Bumps {@link version} only if something was cleared. */
  clearEmbedded(): void {
    if (this.#embedded.size === 0) return;
    this.#embedded.clear();
    this.#version += 1;
    this.#cachedSignature = null;
  }

  /**
   * Drop all runtime overrides AND embedded bindings, reverting to the bundled-only map. Call on a
   * document swap (the same editor instance is reused, so the prior document's `fonts.map` and embedded
   * fonts must not leak into the next). Bumps {@link version} only if something was actually cleared.
   */
  reset(): void {
    if (this.#overrides.size === 0 && this.#embedded.size === 0) return;
    this.#overrides.clear();
    this.#embedded.clear();
    this.#version += 1;
    this.#cachedSignature = null;
  }

  /** Monotonic version; bumps on every mapping change. A lightweight "did it change" signal. */
  get version(): number {
    return this.#version;
  }

  /**
   * Stable content signature of this resolver's runtime mappings - the deterministic,
   * order-independent serialization of its overrides. This (NOT {@link version}) is what
   * measure-cache keys and paint reuse signatures must fold in: two documents can both be at
   * version 1 with DIFFERENT mappings (Georgia->Gelasio vs Georgia->Tinos), and a numeric
   * version would collide; their signatures differ. Empty (no overrides) is `''`, so all
   * default documents share cache safely because they resolve identically.
   */
  get signature(): string {
    if (this.#cachedSignature !== null) return this.#cachedSignature;
    // JSON of sorted [logical, physical] pairs: deterministic and collision-safe even when a font name
    // contains punctuation (a delimited "logical=physical|..." form would not be). Embedded physical
    // names are document-unique, so folding them in gives two embedded-Calibri documents distinct
    // signatures (cache isolation). The activation signature ('' when FULLY active) is folded in too,
    // so a no-pack / curated document never reuses a full-pack document's measures. Memoized until the
    // next mutation.
    const activation = this.#activation.signature;
    const hasOverrides = this.#overrides.size > 0;
    const hasEmbedded = this.#embedded.size > 0;
    // Fully default AND fully active is '' so all default full-pack documents share cache and match
    // the global resolver - the existing common-case identity is preserved exactly.
    if (!hasOverrides && !hasEmbedded && activation === '') {
      this.#cachedSignature = '';
      return this.#cachedSignature;
    }
    const overridePairs = sortPairs([...this.#overrides.entries()]);
    if (activation === '') {
      // Legacy format preserved exactly when activation does not narrow this document (override-only,
      // or override + embedded), so existing signatures/cache identities are unchanged.
      this.#cachedSignature = !hasEmbedded
        ? JSON.stringify(overridePairs)
        : JSON.stringify({ o: overridePairs, e: sortPairs([...this.#embedded.entries()]) });
    } else {
      // Activation narrows this document (no pack, or curated): include it under a distinct `a` key.
      const obj: { o?: Array<[string, string]>; e?: Array<[string, string]>; a: string } = { a: activation };
      if (hasOverrides) obj.o = overridePairs;
      if (hasEmbedded) obj.e = sortPairs([...this.#embedded.entries()]);
      this.#cachedSignature = JSON.stringify(obj);
    }
    return this.#cachedSignature;
  }

  /** The physical family + why, for a bare logical name. Overrides beat the bundled map. */
  #physicalFor(bareFamily: string): { physical: string; reason: FontResolutionReason } {
    const key = normalizeFamilyKey(bareFamily);
    const override = this.#overrides.get(key);
    // An explicit `fonts.map` override is always honored - it is a customer instruction, not a
    // bundled-pack suggestion, so it is NOT gated by activation.
    if (override) return { physical: override, reason: 'custom_mapping' };
    // Bundled substitutes / category fallbacks only apply when this document's pack is active. With
    // no pack configured (baseline), the logical family passes through to system fonts so nothing
    // fetches a substitute that is not being served; curation narrows which families are active.
    if (this.#activation.isActive(bareFamily)) {
      const bundled = BUNDLED_SUBSTITUTES[key];
      if (bundled) return { physical: bundled, reason: 'bundled_substitute' };
      const category = CATEGORY_FALLBACKS[key];
      if (category) return { physical: category, reason: 'category_fallback' };
    }
    return { physical: bareFamily, reason: 'as_requested' };
  }

  /**
   * The provider-precedence ladder for a bare PRIMARY family + face, consulting `hasFace` (the
   * registry's registered-face oracle):
   *   1. explicit `fonts.map` override  -> custom_mapping  (if the override provides the face)
   *   2a. this document's embedded face, under its UNIQUE physical family -> registered_face
   *       (so a shared FontFaceSet renders THIS document's bytes, not another document's same-named font)
   *   2b. a registered real face for the logical family itself (customer `fonts.add`) -> registered_face
   *   3. bundled substitute -> bundled_substitute  (real face, or an explicit docfonts synthetic source)
   *   4. non-metric category fallback -> category_fallback  (if it provides the face; a lower-fidelity
   *      family fallback like Calibri Light -> Carlito, never reported metric-safe)
   *   5. otherwise as_requested (no provider, including a category fallback that lacked the face) - or
   *      fallback_face_absent when an override/bundled substitute WAS known but lacked the face and no
   *      docfonts synthetic source authorized it.
   * `physical === primary` (no swap) for 2b / as_requested / fallback_face_absent; embedded 2a swaps
   * to its document-unique physical family.
   */
  #resolveFaceLadder(primary: string, face: FaceKey, hasFace: HasFace): FaceResolution {
    const key = normalizeFamilyKey(primary);
    const override = this.#overrides.get(key);
    // 1. explicit `fonts.map` override - but only when the mapped family can actually supply this
    //    face. An override that lacks the face does NOT short-circuit: a registered real face for the
    //    logical family (or the bundled clone) can still render it faithfully, and reporting it
    //    fallback_face_absent/missing when a loadable face exists would be a false diagnostic.
    if (override && hasFace(override, face.weight, face.style)) {
      return { physical: override, reason: 'custom_mapping' };
    }
    // 2a. this document's embedded face, under its document-unique physical family. Checked before the
    //     bare logical name so a document always renders its OWN embedded bytes, never another
    //     document's same-named (subset) font sharing the page's FontFaceSet. Gated on hasFace so a
    //     face the document does not embed (e.g. italic) falls through to the bundled substitute.
    const embedded = this.#embedded.get(key);
    if (embedded && hasFace(embedded, face.weight, face.style)) {
      return { physical: embedded, reason: 'registered_face' };
    }
    // 2b. a registered real face for the logical family itself (customer `fonts.add`).
    if (hasFace(primary, face.weight, face.style)) {
      return { physical: primary, reason: 'registered_face' };
    }
    // 3/4. docfonts fallback: either a bundled substitute or a lower-fidelity category fallback - but
    //      ONLY when this document's bundled pack is active for this family (config-presence +
    //      curation). With no pack configured, the family passes through to system fonts so nothing
    //      fetches a substitute that is not served. Query the face-aware docfonts helper instead of
    //      checking the requested face directly: rows may explicitly allow synthetic faces (e.g.
    //      Cooper Black Bold -> Caprasimo Regular), in which case the load gate must await the source
    //      face while paint keeps the requested bold/italic style for browser synthesis.
    const active = this.#activation.isActive(primary);
    if (active) {
      const docfonts = resolveDocfontsFace(primary, face, hasFace);
      if (docfonts) return docfonts;
    }
    // 5. a configured provider (an override, or - when active - a bundled clone) was known but none
    //    could supply this face: pass the logical family through, reported non-metric, never
    //    faux-styled. An inactive bundled clone is treated as no provider (step 6), not an absent face.
    const bundled = active ? BUNDLED_SUBSTITUTES[key] : undefined;
    if (override || bundled) {
      return { physical: primary, reason: 'fallback_face_absent' };
    }
    // 6. no provider at all: render the requested family as-is (browser/system fallback).
    return { physical: primary, reason: 'as_requested' };
  }

  /**
   * Structured resolution of a logical family (or CSS stack) to its bare physical render
   * family. The primary (first) family drives the result; this is what the load gate
   * awaits and what diagnostics report.
   */
  resolveFontFamily(logicalFamily: string): FontResolution {
    const parts = splitStack(logicalFamily);
    const primary = parts[0] ?? logicalFamily;
    const { physical, reason } = this.#physicalFor(primary);
    // physicalFamily is a bare load/report family, never a CSS token: strip quotes a quoted primary
    // carried through (as_requested). No-op for the already-bare substitute/override names.
    return { logicalFamily, physicalFamily: stripFamilyQuotes(physical), reason };
  }

  /**
   * Resolve a CSS font-family value for MEASURE and PAINT: swap the primary family to its
   * physical substitute and keep the original fallbacks. "Calibri, sans-serif" ->
   * "Carlito, sans-serif"; "Calibri" -> "Carlito". An unmapped value is returned unchanged.
   */
  resolvePhysicalFamily(cssFontFamily: string): string {
    if (!cssFontFamily) return cssFontFamily;
    const parts = splitStack(cssFontFamily);
    if (parts.length === 0) return cssFontFamily;
    const { physical, reason } = this.#physicalFor(parts[0]);
    if (reason === 'as_requested') return cssFontFamily;
    return [physical, ...parts.slice(1)].join(', ');
  }

  /**
   * Face-aware structured resolution. Like {@link resolveFontFamily}, but a substitute applies only
   * when the physical family provides the requested face or docfonts explicitly names a synthetic
   * source face. Otherwise the logical family passes through with reason `fallback_face_absent`, so a
   * single-face substitute is never faux-styled by accident. The four-face shipped clones provide every
   * face, so they resolve identically to {@link resolveFontFamily}.
   */
  resolveFace(logicalFamily: string, face: FaceKey, hasFace: HasFace): FontResolution {
    const parts = splitStack(logicalFamily);
    const primary = parts[0] ?? logicalFamily;
    const { physical, reason, sourceFace } = this.#resolveFaceLadder(primary, face, hasFace);
    // physicalFamily is a bare load/report family (the gate awaits it via faceProbe, which re-quotes):
    // strip quotes off a quoted primary carried through for registered_face / fallback_face_absent /
    // as_requested, so the probe matches the registered face instead of a literal "Calibri". The CSS
    // paint variant (resolvePhysicalFamilyForFace) keeps the quoted stack. No-op for substitute names.
    return {
      logicalFamily,
      physicalFamily: stripFamilyQuotes(physical),
      reason,
      ...(sourceFace ? { sourceFace } : {}),
    };
  }

  /**
   * Face-aware CSS-stack variant for MEASURE and PAINT - the face-scoped counterpart of
   * {@link resolvePhysicalFamily}. Swaps the primary family to its substitute when this exact face is
   * real or docfonts authorizes a synthetic source face. Otherwise returns the value unchanged
   * (logical family + its fallbacks), so a missing face is never faux-styled by accident. Measure and
   * paint MUST call this with the same face key, or text is measured in one face and painted in another.
   */
  resolvePhysicalFamilyForFace(cssFontFamily: string, face: FaceKey, hasFace: HasFace): string {
    if (!cssFontFamily) return cssFontFamily;
    const parts = splitStack(cssFontFamily);
    if (parts.length === 0) return cssFontFamily;
    const { physical } = this.#resolveFaceLadder(parts[0], face, hasFace);
    // Swap the primary to the physical whenever resolution actually CHANGED the family - any provider
    // tier, including embedded registered_face aliases. Comparing the family instead of enumerating
    // reasons keeps future provider tiers from needing another paint-path whitelist. Compare NORMALIZED
    // (quote-stripped + lowercased) because a same-name registered_face, as_requested, or
    // fallback_face_absent must not swap just because the primary was quoted or cased.
    if (normalizeFamilyKey(physical) !== normalizeFamilyKey(parts[0])) {
      return [physical, ...parts.slice(1)].join(', ');
    }
    return cssFontFamily;
  }

  /**
   * The bare physical family the load gate must await - the primary family resolved to its
   * substitute. "Calibri, sans-serif" -> "Carlito"; "Calibri" -> "Carlito".
   */
  resolvePrimaryPhysicalFamily(family: string): string {
    const parts = splitStack(family);
    const primary = parts[0] ?? family;
    return this.#physicalFor(primary).physical;
  }

  /** The deduped set of physical face families a set of logical families needs loaded. */
  resolvePhysicalFamilies(families: Iterable<string>): string[] {
    const out = new Set<string>();
    for (const family of families) {
      if (family) out.add(this.resolvePrimaryPhysicalFamily(family));
    }
    return [...out];
  }
}

/**
 * Create a per-document resolver seeded with bundled DocFonts fallbacks. Pass the document's
 * {@link BundledActivation} (from `deriveBundledActivation`) so substitution is gated on the pack
 * being configured and on any curation; omit it for the prior fully-active behavior.
 */
export function createFontResolver(activation?: BundledActivation): FontResolver {
  return new FontResolver(activation);
}

/**
 * Shared default resolver for callers without a document context. Document rendering
 * threads its OWN {@link FontResolver} (so per-document `map` stays isolated); these
 * module functions delegate here and preserve the prior global behavior.
 */
const defaultResolver = new FontResolver();

export function resolveFontFamily(logicalFamily: string): FontResolution {
  return defaultResolver.resolveFontFamily(logicalFamily);
}

export function resolvePhysicalFamily(cssFontFamily: string): string {
  return defaultResolver.resolvePhysicalFamily(cssFontFamily);
}

export function resolvePrimaryPhysicalFamily(family: string): string {
  return defaultResolver.resolvePrimaryPhysicalFamily(family);
}

export function resolvePhysicalFamilies(families: Iterable<string>): string[] {
  return defaultResolver.resolvePhysicalFamilies(families);
}

export function resolveFace(logicalFamily: string, face: FaceKey, hasFace: HasFace): FontResolution {
  return defaultResolver.resolveFace(logicalFamily, face, hasFace);
}

/**
 * Maps a logical CSS family to the physical render family for a SPECIFIC face (weight/style): a
 * per-document `fonts.map` override or a bundled substitute, but only when that substitute provides
 * the face or docfonts authorizes a synthetic source face. The one shared spelling for what was
 * duplicated across the painter, measuring, and planner packages. Face-aware so a single-face clone is
 * never mapped onto a Bold/Italic run it cannot render unless the evidence explicitly allows it.
 */
export type ResolvePhysicalFamily = (cssFontFamily: string, face: FaceKey) => string;

/** Resolve a loaded physical face's deterministic baseline-pitch ratio for the given run text. */
export type ResolveNaturalLineMultiplier = (cssFontFamily: string, face: FaceKey, text: string) => number | undefined;

/**
 * The per-document font identity that every measure and paint path needs, carried as ONE value so
 * the resolver and its signature cannot travel separately and drift:
 * - `resolvePhysical` maps logical -> physical for the document (glyph widths, vertical metrics, paint).
 * - `fontSignature` is the document's stable mapping identity; it keys every measure cache so two
 *   documents (or two renders) with different `fonts.map` never reuse each other's measures.
 *
 * The contract: internal measure helpers take this as a REQUIRED argument and only outer
 * compatibility entry points (e.g. the exported `measureBlock`) default to
 * {@link DEFAULT_FONT_MEASURE_CONTEXT}. Bundling the resolver with its signature is what keeps an
 * internal measure path from silently falling back to the global resolver or pairing a per-document
 * signature with the wrong resolver, and lets every cache site derive its signature from the same
 * context that supplied the resolver. (The required-argument property holds as helpers adopt the
 * context; it is enforced, not assumed, by this pass.)
 */
export interface FontMeasureContext {
  resolvePhysical: ResolvePhysicalFamily;
  resolveNaturalLineMultiplier?: ResolveNaturalLineMultiplier;
  fontSignature: string;
}

/** Font face inputs whose measured digit advances can affect layout reuse. */
export interface FontMeasureFace {
  family: string;
  sizePx: number;
  weight: FaceKey['weight'];
  style: FaceKey['style'];
}

/** Immutable, invocation-scoped facts established by the active measurement surface. */
export interface FontMeasureCapabilities {
  hasTabularDigits(face: FontMeasureFace): boolean;
}

/**
 * The global-resolver / empty-signature context. The behavior-preserving default for outer entry
 * points and non-document callers (tests, the global measure path). Frozen so a stray
 * `DEFAULT_FONT_MEASURE_CONTEXT.resolvePhysical = ...` cannot pollute every default-path document.
 */
export const DEFAULT_FONT_MEASURE_CONTEXT: FontMeasureContext = Object.freeze({
  // Family-level default: no document context means no face-availability oracle, so resolve the
  // primary family and ignore the face axis (the global bundled map, behavior-preserving for
  // non-document callers - tests, the global measure path).
  resolvePhysical: (cssFontFamily: string, _face: FaceKey) => resolvePhysicalFamily(cssFontFamily),
  fontSignature: '',
});
