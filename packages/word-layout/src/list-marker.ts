/**
 * Editor-neutral list marker computation.
 *
 * Combines the editor-neutral numbering helpers from `@superdoc/common`
 * (`generateOrderedListIndex` / `normalizeLvlTextChar`) with the local
 * `createNumberingManager(...)` to produce a `ListRenderingAttrs` payload
 * that `computeWordParagraphLayout(...)` can consume.
 *
 * The function is pure given its inputs; counter state lives on the
 * `NumberingManager` instance passed in. Callers (the v2 adapter, the v1
 * NumberingPlugin) are responsible for scope.
 */
import { generateOrderedListIndex, normalizeLvlTextChar } from '@superdoc/common/list-numbering';
import type { NumberingManager } from './numbering-manager.js';
import type { ListRenderingAttrs, WordListJustification } from './types.js';

export interface WordListMarkerDefinition {
  /** Concrete numId. */
  numId: number | string;
  /** Abstract numbering id for shared counter scoping. */
  abstractId: number | string;
  /** Level index. */
  ilvl: number;
  /** Resolved level start value (override-aware). */
  start: number;
  /** True if the start value came from `w:lvlOverride/w:startOverride`. */
  startOverridden: boolean;
  /** `w:lvlRestart` value when defined. */
  restart?: number;
  /** Level text template. May be empty when none defined. */
  lvlText?: string;
  /** Effective `w:numFmt/@w:val`. */
  numFmt?: string;
  /** Custom format string when `numFmt === 'custom'`. */
  customFormat?: string;
  /** True when the level carries Word's legal-numbering semantics. */
  isLegal?: boolean;
  /** Effective numbering formats for placeholders that reference each level. */
  levelNumberingFormats?: Array<{
    ilvl: number;
    numFmt?: string;
    customFormat?: string;
  }>;
  /** `w:suff`. Defaults to `tab` when absent. */
  suffix?: string;
  /** `w:lvlJc`. Defaults to `left`. */
  justification?: string;
  /**
   * Effective start settings for ancestor levels `0..ilvl-1`. Registered with
   * `ensureStartSettings` (register-if-absent) before the marker path is
   * computed so first-emitted nested markers fall back to OOXML-defined
   * ancestor starts instead of `1`. Real ancestor counters still win.
   */
  ancestorStartSettings?: Array<{
    ilvl: number;
    start: number;
    restart?: number;
    startOverridden: boolean;
  }>;
}

export interface ComputeWordListMarkerInput {
  /** Resolved marker definition. */
  definition: WordListMarkerDefinition;
  /**
   * Numbering manager instance carrying counter state for this projection.
   * The caller must have already called `setStartSettings(...)` for the
   * paragraph's level (this is typically done up-front per (numId, level)
   * pair when paragraphs are first walked).
   */
  manager: NumberingManager;
  /**
   * Source-order key for this paragraph. Must be monotonically increasing
   * for paragraphs within a projection so the counter manager can detect
   * previous siblings.
   */
  paragraphOrdinal: number;
}

export interface ComputeWordListMarkerResult {
  listRenderingAttrs: ListRenderingAttrs;
  /** Computed numeric counter path. Useful for callers that want it directly. */
  path: number[];
  /** Effective counter value at the requested ilvl. */
  counter: number;
}

/**
 * Compute the marker text, list-rendering attributes, and counter path for
 * one numbered paragraph. Advances the manager state by recording the new
 * counter at the given paragraph ordinal.
 */
export function computeWordListMarker(input: ComputeWordListMarkerInput): ComputeWordListMarkerResult {
  const { definition, manager, paragraphOrdinal } = input;
  // Prime ancestor-level start settings first (register-if-absent) so that when
  // the first emitted paragraph is at ilvl > 0 and no ancestor counter exists
  // yet, ancestor path segments fall back to the OOXML-defined ancestor starts
  // rather than 1. Real ancestor counters always take precedence in
  // getAncestorsPath, so this never overrides genuine prior numbering.
  if (definition.ancestorStartSettings) {
    for (const ancestor of definition.ancestorStartSettings) {
      manager.ensureStartSettings(
        definition.numId,
        ancestor.ilvl,
        ancestor.start,
        ancestor.restart,
        ancestor.startOverridden,
      );
    }
  }
  // Ensure start settings are recorded (idempotent).
  manager.setStartSettings(
    definition.numId,
    definition.ilvl,
    definition.start,
    definition.restart,
    definition.startOverridden,
  );

  const counter = manager.calculateCounter(definition.numId, definition.ilvl, paragraphOrdinal, definition.abstractId);
  manager.setCounter(definition.numId, definition.ilvl, paragraphOrdinal, counter, definition.abstractId);
  const path = manager.calculatePath(definition.numId, definition.ilvl, paragraphOrdinal);

  const numberingType = definition.numFmt ?? 'decimal';
  let markerText = '';
  if (numberingType === 'bullet') {
    const bulletText = definition.isLegal
      ? formatNumberingTemplate(definition, path, numberingType)
      : definition.lvlText;
    markerText = normalizeLvlTextChar(bulletText) ?? '';
  } else {
    markerText = formatNumberingTemplate(definition, path, numberingType);
  }

  return {
    listRenderingAttrs: {
      markerText,
      numberingType,
      path,
      suffix: normalizeSuffix(definition.suffix),
      justification: normalizeJustification(definition.justification),
    },
    path,
    counter,
  };
}

function formatNumberingTemplate(definition: WordListMarkerDefinition, path: number[], numberingType: string): string {
  const template = definition.lvlText ?? '';
  if (!definition.levelNumberingFormats || definition.levelNumberingFormats.length === 0) {
    if (numberingType === 'none') return '';
    return (
      generateOrderedListIndex({
        listLevel: path,
        lvlText: template,
        listNumberingType: legalEquivalent(numberingType, definition.isLegal),
        customFormat: definition.customFormat,
      }) ?? ''
    );
  }
  const formats = new Map(definition.levelNumberingFormats.map((format) => [format.ilvl, format] as const));
  return template.replace(/%(\d+)/g, (match, oneBasedLiteral: string) => {
    const referencedLevel = Number.parseInt(oneBasedLiteral, 10) - 1;
    const ordinal = path[referencedLevel];
    if (!Number.isFinite(ordinal)) return match;
    const format = formats.get(referencedLevel);
    const effectiveNumberingType = format?.numFmt ?? (referencedLevel === definition.ilvl ? numberingType : 'decimal');
    const listNumberingType = legalEquivalent(effectiveNumberingType, definition.isLegal);
    return (
      generateOrderedListIndex({
        listLevel: path,
        lvlText: `%${referencedLevel + 1}`,
        listNumberingType,
        customFormat: format?.customFormat,
      }) ?? ''
    );
  });
}

const ARABIC_NUMBER_FORMATS = new Set(['decimal', 'decimalZero']);

// SD-5466: a format that already counts in Arabic digits is its own decimal equivalent, so Word 16 renders a legal decimalZero level as `SECTION 1.01`.
function legalEquivalent(numberingType: string, isLegal: boolean | undefined): string {
  if (!isLegal || numberingType === 'none' || ARABIC_NUMBER_FORMATS.has(numberingType)) return numberingType;
  return 'decimal';
}

function normalizeSuffix(suffix: string | undefined): ListRenderingAttrs['suffix'] {
  if (suffix === 'tab' || suffix === 'space' || suffix === 'nothing') return suffix;
  return 'tab';
}

function normalizeJustification(jc: string | undefined): WordListJustification {
  if (jc === 'center') return 'center';
  if (jc === 'right' || jc === 'end') return 'right';
  return 'left';
}
