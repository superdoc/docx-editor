/**
 * Tracked changes processing logic for PM adapter
 *
 * Handles rendering modes (review/original/final), metadata extraction,
 * and priority selection for overlapping tracked change marks.
 */

/**
 * Length of random component in generated tracked change IDs.
 * Used when ID is not provided in mark attributes.
 */
const RANDOM_ID_LENGTH = 9;

const generateRandomBase36Id = (length: number): string => {
  let randomId = '';
  while (randomId.length < length) {
    randomId += Math.random().toString(36).slice(2);
  }
  return randomId.slice(0, length);
};

import type {
  Run,
  TextRun,
  TabRun,
  BreakRun,
  TrackedChangeMeta,
  TrackedChangeKind,
  TrackedChangesMode,
  RunMark,
} from '@superdoc/contracts';
import type { PMMark, TrackedChangesConfig, HyperlinkConfig, ThemeColorPalette } from './types.js';
import {
  TRACK_CHANGE_KIND_MAP,
  TRACK_CHANGE_PRIORITY,
  VALID_TRACKED_MODES,
  MAX_RUN_MARK_JSON_LENGTH,
  MAX_RUN_MARK_ARRAY_LENGTH,
  MAX_RUN_MARK_DEPTH,
  DEFAULT_HYPERLINK_CONFIG,
} from './constants.js';

/**
 * Type guard to validate that a value is a valid TrackedChangesMode.
 * Prevents unsafe type casts and ensures runtime type safety.
 *
 * @param value - The value to check
 * @returns True if value is a valid TrackedChangesMode
 */
export const isValidTrackedMode = (value: unknown): value is TrackedChangesMode => {
  return typeof value === 'string' && (VALID_TRACKED_MODES as readonly string[]).includes(value);
};

/**
 * Type guard to check if a run is a text run.
 * Safely distinguishes TextRun from TabRun by checking for 'text' property.
 *
 * @param run - The run to check
 * @returns True if the run is a TextRun
 */
export const isTextRun = (run: Run): run is TextRun => {
  return 'text' in run && run.kind !== 'tab';
};

/**
 * Strips tracked change metadata from a run
 *
 * @param run - The run to strip tracked change from
 */
export const stripTrackedChangeFromRun = (run: Run): void => {
  if ('trackedChange' in run && run.trackedChange) {
    delete run.trackedChange;
  }
  if ('trackedChanges' in run && run.trackedChanges) {
    delete run.trackedChanges;
  }
};

/**
 * Maps a ProseMirror mark type to a tracked change kind
 *
 * @param markType - The PM mark type string
 * @returns The corresponding TrackedChangeKind, or undefined
 */
export const pickTrackedChangeKind = (markType: string): TrackedChangeKind | undefined => {
  return TRACK_CHANGE_KIND_MAP[markType];
};

/**
 * Validates JSON object depth to prevent deeply nested structures.
 * Recursively checks nesting level to prevent stack overflow attacks.
 *
 * @param obj - The object to validate
 * @param currentDepth - Current recursion depth (internal use)
 * @returns true if within depth limit, false otherwise
 */
const validateDepth = (obj: unknown, currentDepth = 0): boolean => {
  if (currentDepth > MAX_RUN_MARK_DEPTH) {
    return false;
  }
  if (obj && typeof obj === 'object') {
    const values = Array.isArray(obj) ? obj : Object.values(obj);
    for (const value of values) {
      if (!validateDepth(value, currentDepth + 1)) {
        return false;
      }
    }
  }
  return true;
};

/**
 * Normalizes and validates run mark lists from trackFormat metadata.
 * Applies security limits to prevent DoS attacks from malicious payloads.
 *
 * @param value - Raw mark list (string JSON or array)
 * @returns Normalized RunMark array, or undefined if validation fails
 */
export const normalizeRunMarkList = (value: unknown): RunMark[] | undefined => {
  if (value === undefined || value === null) return undefined;
  let entries: unknown = value;
  if (typeof value === 'string') {
    // Prevent DoS attacks from extremely large JSON payloads
    if (value.length > MAX_RUN_MARK_JSON_LENGTH) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[PM-Adapter] Rejecting run mark JSON payload exceeding ${MAX_RUN_MARK_JSON_LENGTH} chars`);
      }
      return undefined;
    }
    try {
      entries = JSON.parse(value);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PM-Adapter] Failed to parse run mark JSON:', error);
      }
      return undefined;
    }
  }
  if (!Array.isArray(entries)) {
    return undefined;
  }
  if (entries.length > MAX_RUN_MARK_ARRAY_LENGTH) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[PM-Adapter] Rejecting run mark array exceeding ${MAX_RUN_MARK_ARRAY_LENGTH} entries`);
    }
    return undefined;
  }
  if (!validateDepth(entries)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[PM-Adapter] Rejecting run mark array exceeding depth ${MAX_RUN_MARK_DEPTH}`);
    }
    return undefined;
  }
  const normalized = entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : undefined;
      if (!type) return null;
      const attrs =
        record.attrs && typeof record.attrs === 'object' ? (record.attrs as Record<string, unknown>) : undefined;
      return { type, attrs } as RunMark;
    })
    .filter(Boolean) as RunMark[];
  return normalized.length ? normalized : undefined;
};

/**
 * Derives a unique tracked change ID from mark attributes.
 * Falls back to generating a unique ID from author/date/timestamp if not provided.
 *
 * Fallback ID format: `{kind}-{authorEmail}-{date}-{timestamp}-{random}`
 * where:
 * - kind: insert/delete/format
 * - authorEmail: author's email or 'unknown'
 * - date: ISO date string or 'unknown'
 * - timestamp: current milliseconds since epoch
 * - random: 9-character base-36 random string
 *
 * Uniqueness is guaranteed by combining timestamp and random components,
 * ensuring collision-free IDs even when author/date are missing.
 *
 * @param kind - The tracked change kind (insert/delete/format)
 * @param attrs - Mark attributes containing id, author, and date
 * @returns A unique tracked change ID
 *
 * @example
 * // With provided ID
 * deriveTrackedChangeId('insert', { id: 'custom-123' })
 * // => 'custom-123'
 *
 * @example
 * // Fallback generation with full metadata
 * deriveTrackedChangeId('insert', { authorEmail: 'user@example.com', date: '2025-01-15' })
 * // => 'insert-user@example.com-2025-01-15-1736956800000-abc123def'
 *
 * @example
 * // Fallback generation with missing metadata
 * deriveTrackedChangeId('format', {})
 * // => 'format-unknown-unknown-1736956800000-xyz789ghi'
 */
export const deriveTrackedChangeId = (kind: TrackedChangeKind, attrs: Record<string, unknown> | undefined): string => {
  if (attrs && typeof attrs.id === 'string' && attrs.id.trim()) {
    return attrs.id;
  }
  const authorEmail = attrs && typeof attrs.authorEmail === 'string' ? attrs.authorEmail : 'unknown';
  const date = attrs && typeof attrs.date === 'string' ? attrs.date : 'unknown';
  // Add timestamp and random component to ensure uniqueness when author/date are missing
  const unique = `${Date.now()}-${generateRandomBase36Id(RANDOM_ID_LENGTH)}`;
  return `${kind}-${authorEmail}-${date}-${unique}`;
};

/**
 * Builds tracked change metadata from a ProseMirror mark.
 * Extracts author info, timestamps, and before/after formatting for trackFormat marks.
 *
 * @param mark - ProseMirror mark containing tracked change attributes
 * @returns TrackedChangeMeta object, or undefined if not a tracked change mark
 */
export const buildTrackedChangeMetaFromMark = (mark: PMMark, storyKey?: string): TrackedChangeMeta | undefined => {
  const kind = pickTrackedChangeKind(mark.type);
  if (!kind) return undefined;
  const attrs = mark.attrs ?? {};
  const meta: TrackedChangeMeta = {
    kind,
    id: deriveTrackedChangeId(kind, attrs),
  };
  if (typeof attrs.overlapParentId === 'string' && attrs.overlapParentId) {
    meta.overlapParentId = attrs.overlapParentId;
    meta.relationship = 'child';
  }
  if (typeof attrs.author === 'string' && attrs.author) {
    meta.author = attrs.author;
  }
  if (typeof attrs.authorEmail === 'string' && attrs.authorEmail) {
    meta.authorEmail = attrs.authorEmail;
  }
  if (typeof attrs.authorImage === 'string' && attrs.authorImage) {
    meta.authorImage = attrs.authorImage;
  }
  if (typeof attrs.date === 'string' && attrs.date) {
    meta.date = attrs.date;
  }
  if (kind === 'format') {
    meta.before = normalizeRunMarkList((attrs as { before?: unknown }).before);
    meta.after = normalizeRunMarkList((attrs as { after?: unknown }).after);
  }
  if (typeof storyKey === 'string' && storyKey.length > 0) {
    meta.storyKey = storyKey;
  }
  return meta;
};

/**
 * Selects the higher-priority tracked change metadata when multiple marks overlap.
 * Insert/delete marks (priority 3) take precedence over format marks (priority 1).
 *
 * @param existing - Current tracked change metadata, if any
 * @param next - New tracked change metadata to consider
 * @returns The higher-priority metadata
 */
export const selectTrackedChangeMeta = (
  existing: TrackedChangeMeta | undefined,
  next: TrackedChangeMeta,
): TrackedChangeMeta => {
  if (!existing) return next;
  const existingPriority = TRACK_CHANGE_PRIORITY[existing.kind] ?? 0;
  const nextPriority = TRACK_CHANGE_PRIORITY[next.kind] ?? 0;
  if (nextPriority > existingPriority) {
    return next;
  }
  return existing;
};

const normalizeTrackedChangeLayers = (run: TextRun | BreakRun | TabRun): TrackedChangeMeta[] => {
  if (Array.isArray(run.trackedChanges) && run.trackedChanges.length > 0) {
    return run.trackedChanges;
  }
  return run.trackedChange ? [run.trackedChange] : [];
};

const isTrackedChangeRun = (run: Run): run is TextRun | BreakRun | TabRun => {
  // Tab runs participate in visibility filtering and highlighting (SD-3376).
  return isTextRun(run) || run.kind === 'break' || run.kind === 'tab';
};

const runHasTrackedChangeKind = (run: Run, kind: TrackedChangeKind): boolean => {
  if (!isTrackedChangeRun(run)) return false;
  return normalizeTrackedChangeLayers(run).some((layer) => layer.kind === kind);
};

const stripTrackedChangeKindsFromRun = (run: Run, kinds: readonly TrackedChangeKind[]): void => {
  if (!isTrackedChangeRun(run)) return;

  const hiddenKinds = new Set(kinds);
  const remainingLayers = normalizeTrackedChangeLayers(run).filter((layer) => !hiddenKinds.has(layer.kind));

  if (remainingLayers.length === 0) {
    stripTrackedChangeFromRun(run);
    return;
  }

  run.trackedChange = remainingLayers[0];
  if (remainingLayers.length > 1) {
    run.trackedChanges = remainingLayers;
  } else {
    delete run.trackedChanges;
  }
};

/**
 * Checks if two text runs have compatible tracked change metadata for merging.
 * Runs are compatible if they have the same kind and ID, or both have no metadata.
 *
 * @param a - First text run
 * @param b - Second text run
 * @returns true if runs can be merged, false otherwise
 */
export const trackedChangesCompatible = (a: TextRun, b: TextRun): boolean => {
  const aLayers = normalizeTrackedChangeLayers(a);
  const bLayers = normalizeTrackedChangeLayers(b);
  if (aLayers.length !== bLayers.length) return false;
  return aLayers.every((aMeta, index) => {
    const bMeta = bLayers[index];
    return Boolean(bMeta && aMeta.kind === bMeta.kind && aMeta.id === bMeta.id);
  });
};

/**
 * Determines if a tracked node should be hidden based on the viewing mode
 *
 * @param meta - Tracked change metadata
 * @param config - Tracked changes configuration
 * @returns true if the node should be hidden
 */
export const shouldHideTrackedNode = (meta: TrackedChangeMeta | undefined, config?: TrackedChangesConfig): boolean => {
  if (!meta || !config || !config.enabled) return false;
  if (config.mode === 'original' && meta.kind === 'insert') return true;
  if (config.mode === 'final' && meta.kind === 'delete') return true;
  return false;
};

/**
 * Annotates a block with tracked change metadata if applicable
 *
 * @param block - The block to annotate
 * @param meta - Tracked change metadata to apply
 * @param config - Tracked changes configuration
 */
export const annotateBlockWithTrackedChange = (
  block: { attrs?: Record<string, unknown> },
  meta: TrackedChangeMeta | undefined,
  config?: TrackedChangesConfig,
): void => {
  if (!meta) return;
  if (!config || !config.enabled || config.mode === 'off') return;
  block.attrs = {
    ...(block.attrs ?? {}),
    trackedChange: meta,
  };
};

/**
 * Reset all formatting properties on a run to defaults, preserving text and metadata.
 * Clears bold, italic, color, underline, strike, highlight, link, and letterSpacing.
 *
 * NOTE: fontFamily and fontSize are intentionally preserved, as they represent
 * default text properties rather than explicit formatting changes. These values
 * may come from paragraph or document defaults and should not be removed when
 * reverting tracked format changes.
 *
 * @param run - The text run to reset
 */
export const resetRunFormatting = (run: TextRun): void => {
  delete run.bold;
  delete run.italic;
  delete run.color;
  delete run.underline;
  delete run.strike;
  delete run.highlight;
  delete run.link;
  delete run.letterSpacing;
  delete run.vertAlign;
  delete run.baselineShift;
  // Keep fontFamily and fontSize as they may be defaults, not formatting changes
};

/**
 * Apply format change marks to a run based on tracked changes mode.
 * For 'original' mode, applies the 'before' marks to show original formatting.
 * For 'review' and 'final' modes, the run already has 'after' marks applied.
 *
 * Includes error handling for invalid mark data. If applying marks fails,
 * the run's formatting is reset to defaults to prevent partial/corrupted state.
 *
 * NOTE: This function requires applyMarksToRun from marks.ts, which creates a circular dependency.
 * The actual implementation is in the main conversion logic.
 *
 * @param run - The text run to modify
 * @param config - Tracked changes configuration
 * @param hyperlinkConfig - Hyperlink configuration
 * @param applyMarksToRun - Function to apply marks to run (injected to avoid circular dependency)
 */
export const applyFormatChangeMarks = (
  run: TextRun,
  config: TrackedChangesConfig,
  hyperlinkConfig: HyperlinkConfig,
  applyMarksToRun: (
    run: TextRun,
    marks: PMMark[],
    config: HyperlinkConfig,
    themeColors?: ThemeColorPalette,
    backgroundColor?: string,
    enableComments?: boolean,
    storyKey?: string,
  ) => void,
  themeColors?: ThemeColorPalette,
  enableComments = true,
  storyKey?: string,
): void => {
  const tracked = run.trackedChange;
  if (!tracked || tracked.kind !== 'format') {
    return;
  }

  // Only apply 'before' marks in 'original' mode
  if (config.mode !== 'original') {
    return;
  }

  const beforeMarks = tracked.before;
  if (!beforeMarks || beforeMarks.length === 0) {
    // No 'before' marks means original formatting had none - reset to defaults
    resetRunFormatting(run);
    return;
  }

  // Validate beforeMarks before casting to PMMark[]
  const isValidMarkArray = beforeMarks.every(
    (mark): mark is PMMark =>
      mark !== null && typeof mark === 'object' && 'type' in mark && typeof mark.type === 'string',
  );

  if (!isValidMarkArray) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[PM-Adapter] Invalid before marks in tracked change, resetting formatting');
    }
    resetRunFormatting(run);
    return;
  }

  // Reset all formatting first, then apply 'before' marks
  resetRunFormatting(run);

  try {
    applyMarksToRun(run, beforeMarks as PMMark[], hyperlinkConfig, themeColors, undefined, enableComments, storyKey);
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[PM-Adapter] Error applying format change marks, resetting formatting:', error);
    }
    // On error, ensure run is in clean state with no formatting
    resetRunFormatting(run);
  }
};

/**
 * Applies tracked changes mode filtering and metadata stripping to runs.
 * Filters out runs based on mode (original/final) and strips metadata when disabled.
 *
 * @param runs - Array of runs to process
 * @param config - Tracked changes configuration
 * @param hyperlinkConfig - Hyperlink configuration
 * @param applyMarksToRun - Function to apply marks to run (injected to avoid circular dependency)
 * @returns Filtered and processed array of runs
 */
export const applyTrackedChangesModeToRuns = (
  runs: Run[],
  config: TrackedChangesConfig | undefined,
  hyperlinkConfig: HyperlinkConfig,
  applyMarksToRun: (
    run: TextRun,
    marks: PMMark[],
    config: HyperlinkConfig,
    themeColors?: ThemeColorPalette,
    backgroundColor?: string,
    enableComments?: boolean,
    storyKey?: string,
  ) => void,
  themeColors?: ThemeColorPalette,
  enableComments = true,
  storyKey?: string,
): Run[] => {
  if (!config) {
    return runs;
  }
  const metadataDisabled = !config.enabled || config.mode === 'off';
  const hideInsertions = config.enabled && config.mode === 'original';
  const hideDeletions = config.enabled && config.mode === 'final';

  if (!hideInsertions && !hideDeletions) {
    if (metadataDisabled) {
      runs.forEach((run) => stripTrackedChangeFromRun(run));
    } else {
      // Apply format changes even when not filtering insertions/deletions
      runs.forEach((run) => {
        if (isTextRun(run)) {
          applyFormatChangeMarks(run, config, hyperlinkConfig, applyMarksToRun, themeColors, enableComments, storyKey);
        }
      });
    }
    return runs;
  }

  const filtered: Run[] = [];
  runs.forEach((run) => {
    if (!isTrackedChangeRun(run)) {
      filtered.push(run);
      return;
    }
    if (!isTrackedChangeRun(run) || normalizeTrackedChangeLayers(run).length === 0) {
      filtered.push(run);
      return;
    }
    if (hideInsertions && runHasTrackedChangeKind(run, 'insert')) {
      return;
    }
    if (hideDeletions && runHasTrackedChangeKind(run, 'delete')) {
      return;
    }
    filtered.push(run);
  });

  if (metadataDisabled) {
    filtered.forEach((run) => stripTrackedChangeFromRun(run));
  } else {
    // Apply format changes to filtered runs
    filtered.forEach((run) => {
      if (isTextRun(run)) {
        applyFormatChangeMarks(
          run,
          config,
          hyperlinkConfig || DEFAULT_HYPERLINK_CONFIG,
          applyMarksToRun,
          themeColors,
          enableComments,
          storyKey,
        );
      }
    });

    // In 'original' mode we want to show the document before tracked changes.
    // After filtering out insertions, strip remaining tracked-change metadata so deletions render as normal text.
    // In 'final' mode we want to show the document with all changes accepted.
    // After filtering out deletions, strip remaining tracked-change metadata so insertions render as normal text.
    // Note: We only strip 'insert' and 'delete' kinds, not 'format' kind which should remain visible.
    if ((config.mode === 'original' || config.mode === 'final') && config.enabled) {
      filtered.forEach((run) => {
        if (runHasTrackedChangeKind(run, 'insert') || runHasTrackedChangeKind(run, 'delete')) {
          stripTrackedChangeKindsFromRun(run, ['insert', 'delete']);
        }
      });
    }
  }

  return filtered;
};
