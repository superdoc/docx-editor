/**
 * Browser / `<script>` (IIFE) entry for `@superdoc/fonts`, built to
 * `dist/superdoc-fonts.min.js` and exposed as the `SuperDocFonts` global.
 *
 * Unlike the bundler entry ({@link "./index"}), it resolves the `.woff2` relative to its OWN
 * `<script>` (`document.currentScript`) instead of `import.meta.url`, so a plain CDN / self-host
 * `<script>` tag works with no bundler:
 *
 *     <script src="https://cdn.jsdelivr.net/npm/superdoc@next/dist-cdn/superdoc.min.js"></script>
 *     <script src="https://cdn.jsdelivr.net/npm/@superdoc/fonts/dist/superdoc-fonts.min.js"></script>
 *     <script>
 *       new SuperDoc({ selector: '#editor', document: 'contract.docx', fonts: SuperDocFonts.superdocFonts });
 *     </script>
 *
 * The faces ship in the package's `assets/` dir and this bundle in `dist/`, so a face resolves to
 * `../assets/<file>` relative to the script. On a public CDN (jsDelivr / unpkg) the whole package
 * is served, so that resolves with no setup; self-hosting requires the `dist/` and `assets/` dirs
 * to keep their relative layout.
 *
 * @beta
 */
import { BUNDLED_FONT_FILES } from './bundled-files.js';
import {
  resolveCuration,
  type BundledFontAssetContext,
  type SuperDocFontsConfig,
  type SuperDocFontsOptions,
} from './curation.js';

// Capture the executing <script> src at load. `document.currentScript` is valid while this
// top-level IIFE runs and null later (e.g. in async callbacks), so it MUST be read here, at module
// eval, not inside the resolver. Duck-typed (no `instanceof HTMLScriptElement`) so the module also
// evaluates under a non-DOM test environment where that constructor is absent.
const currentScript = typeof document !== 'undefined' ? (document.currentScript as { src?: string } | null) : null;
const SCRIPT_SRC: string = currentScript?.src ?? '';

const KNOWN_FILES: ReadonlySet<string> = new Set(BUNDLED_FONT_FILES);

/**
 * Resolve a bundled face filename to a URL relative to THIS script. Throws on an unknown file
 * (a version mismatch between `@superdoc/fonts` and `superdoc`) and on a missing script URL,
 * matching the bundler entry's fail-loud-not-silent contract.
 *
 * @beta
 */
export function resolveBundledFontAssetUrl(context: BundledFontAssetContext): string {
  if (!KNOWN_FILES.has(context.file)) {
    throw new Error(
      `[@superdoc/fonts] no bundled asset for "${context.file}". This pack ships ` +
        `${BUNDLED_FONT_FILES.length} faces; the file is unknown, so @superdoc/fonts and ` +
        `superdoc are likely version-mismatched. Align their versions.`,
    );
  }
  if (!SCRIPT_SRC) {
    throw new Error(
      '[@superdoc/fonts] could not determine the script URL to resolve bundled fonts from. ' +
        'Load superdoc-fonts.min.js with a normal <script src="..."> tag.',
    );
  }
  return new URL(`../assets/${context.file}`, SCRIPT_SRC).href;
}

/**
 * Drop-in value for SuperDoc's `fonts` config: `new SuperDoc({ fonts: SuperDocFonts.superdocFonts })`.
 *
 * @beta
 */
export const superdocFonts: SuperDocFontsConfig = { resolveAssetUrl: resolveBundledFontAssetUrl };

/**
 * Build a curated `fonts` config: the bundled pack narrowed to the families you choose. Same API
 * and validation as the bundler entry's `createSuperDocFonts`; only the resolver differs.
 *
 *     new SuperDoc({ fonts: SuperDocFonts.createSuperDocFonts({ exclude: ['Cooper Black'] }) });
 *
 * @beta
 */
export function createSuperDocFonts(options: SuperDocFontsOptions = {}): SuperDocFontsConfig {
  return { resolveAssetUrl: resolveBundledFontAssetUrl, ...resolveCuration(options) };
}

export type { BundledFontAssetContext, SuperDocFontsConfig, SuperDocFontsOptions };
export { BUNDLED_FAMILY_NAMES } from './bundled-families.js';
export type { BundledFontFamilyName } from './bundled-families.js';
