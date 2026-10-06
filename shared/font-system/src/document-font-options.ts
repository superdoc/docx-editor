/**
 * Document-scoped font options for the toolbar: one option per logical family a loaded document
 * actually uses. Distinct from the static {@link ./font-offerings} (the bundled choices): this is
 * runtime and document-scoped because it needs the document's registry and resolver.
 *
 * Each option also carries the rendered generic fallback for host-built previews.
 */
import { getGenericFontFamily } from '@superdoc/font-utils';
import { type BundledActivation, BASELINE_BUNDLED } from './activation';
import { buildFaceReport, type FontResolutionRecord, type UsedFace } from './report';
import { getBuiltInToolbarFontOfferings } from './font-offerings';
import type { FontRegistry } from './registry';
import type { FontResolver } from './resolver';

/**
 * One document font for the toolbar: the logical name (the dropdown label and the value stored and
 * exported) and the family to render its preview in.
 */
export interface DocumentFontOption {
  /** The Word-facing logical family: the dropdown label and the value stored + exported (e.g. "Aptos"). */
  logicalFamily: string;
  /**
   * The physical family to render the dropdown PREVIEW in (Calibri previews as Carlito; a document-
   * provided font previews as itself). The regular face is used as the representative when present.
   */
  previewFamily: string;
  /** First CSS generic in the rendered logical stack, or null when that stack has none. */
  genericFamily: string | null;
}

/** Normalize a family for dedupe: trim, strip surrounding quotes, lowercase (matches the resolver key). */
function normalizeKey(family: string): string {
  return family
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();
}

/**
 * The Word-facing logical family name: the first family of a CSS font stack, with surrounding
 * quotes stripped. Document runs can carry a fallback stack (e.g. `"Arial, sans-serif"`) as their
 * family; the picker advertises the logical font (`Arial`), not the stack, so it dedupes against the
 * bundled offerings instead of listing `Arial` and `Arial, sans-serif` as separate rows.
 *
 * Quote-aware: a quoted family may legally contain a comma (e.g. `'"Acme, Inc Sans", sans-serif'`),
 * so a plain comma split would truncate the name. The first family is read from the leading quoted
 * token when present, otherwise up to the first comma.
 */
function canonicalFamilyName(family: string): string {
  const trimmed = family.trim();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const close = trimmed.indexOf(quote, 1);
    if (close > 0) return trimmed.slice(1, close).trim();
  }
  const comma = trimmed.indexOf(',');
  const first = comma === -1 ? trimmed : trimmed.slice(0, comma);
  return first.trim().replace(/^["']|["']$/g, '');
}

function isRegularFace(rec: FontResolutionRecord): boolean {
  return rec.face?.weight === '400' && rec.face?.style === 'normal';
}

/**
 * The document-specific font options for the toolbar: one per LOGICAL family the document renders,
 * deduped, each with the family that actually paints its preview. Resolved FACE-aware (via
 * {@link buildFaceReport}) so an embedded / customer font the document supplies is detected even when
 * no bundled clone exists.
 */
export function buildDocumentFontOptions(
  usedFaces: Iterable<UsedFace>,
  registry: FontRegistry,
  resolver?: FontResolver,
): DocumentFontOption[] {
  const faceRecords = buildFaceReport(usedFaces, registry, resolver);
  const agg = new Map<string, FontResolutionRecord>();
  for (const rec of faceRecords) {
    const key = normalizeKey(rec.logicalFamily);
    const existing = agg.get(key);
    if (!existing) {
      agg.set(key, rec);
      continue;
    }
    if (isRegularFace(rec) && !isRegularFace(existing)) agg.set(key, rec);
  }
  const options: DocumentFontOption[] = [];
  for (const rep of agg.values()) {
    options.push({
      logicalFamily: rep.logicalFamily,
      previewFamily: rep.physicalFamily,
      genericFamily: getGenericFontFamily(rep.logicalFamily),
    });
  }
  return options;
}

/**
 * Final, dropdown-ready font family option. `label` and `value` are the logical family; `previewFamily`
 * is only for rendering the row preview.
 */
export interface FontFamilyOption {
  /** Display text: the Word-facing logical family (e.g. "Calibri"). */
  label: string;
  /** Value to apply with the font-family command. */
  value: string;
  /** Physical family used to render the option preview. */
  previewFamily: string;
}

function compareByLabel(a: FontFamilyOption, b: FontFamilyOption): number {
  return a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
}

/**
 * Compose the final font-family picker list from the built-in toolbar choices plus the active
 * document's fonts. The built-in choices are gated on the document's bundled-font {@link
 * BundledActivation} (baseline when no pack is configured, the curated rich set when it is); pass it
 * from the editor so the picker advertises only what this document will render. Document fonts are
 * always listed - they come from the loaded document itself. Sorted alphabetically, deduped by
 * logical family.
 */
export function buildFontFamilyOptions(
  documentOptions: ReadonlyArray<Pick<DocumentFontOption, 'logicalFamily' | 'previewFamily'>>,
  activation: BundledActivation = BASELINE_BUNDLED,
): FontFamilyOption[] {
  const seen = new Set<string>();
  const options: FontFamilyOption[] = [];
  // Add one row per logical family, keyed on the canonical (first-family) name so a document's
  // CSS-stack family collapses onto the matching bundled offering instead of producing a duplicate
  // row. `previewFamily` keeps the renderable family (the physical clone or the document's own).
  const add = (logicalFamily: string, previewFamily: string): void => {
    const canonical = canonicalFamilyName(logicalFamily);
    if (!canonical) return;
    const key = canonical.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ label: canonical, value: canonical, previewFamily: previewFamily || canonical });
  };
  for (const offering of getBuiltInToolbarFontOfferings(activation)) {
    // Preview in the physical clone (e.g. Carlito) only when the pack is configured and thus served.
    // In baseline the clone is neither registered nor served, so previewing in it would render a
    // generic fallback that misrepresents the painted text - use the logical family that renders.
    const previewFamily = activation.packConfigured
      ? offering.physicalFamily || offering.logicalFamily
      : offering.logicalFamily;
    add(offering.logicalFamily, previewFamily);
  }
  for (const option of documentOptions) {
    add(option.logicalFamily, option.previewFamily || option.logicalFamily);
  }
  return options.sort(compareByLabel);
}
