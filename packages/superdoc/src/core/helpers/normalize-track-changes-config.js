// @ts-check

/**
 * @typedef {'review' | 'original' | 'final' | 'off'} TrackChangesMode
 * @typedef {'original' | 'markup' | 'final'} ViewingTrackedChangesMode
 * @typedef {'grouped' | 'separate'} TrackChangesReplacementMode
 * @typedef {'paired' | 'independent'} InternalTrackChangesReplacementMode
 * @typedef {{ enabled?: boolean, overrides?: Record<string, string>, resolve?: (author: { name?: string, email?: string, image?: string }) => (string | undefined) }} AuthorColorsConfig
 * @typedef {import('../types/index.js').TrackedChangeSemanticColorKey} TrackedChangeSemanticColorKey
 * @typedef {{ key: TrackedChangeSemanticColorKey, author?: { name?: string, email?: string, image?: string }, type?: string, subtype?: string, targetKind?: string, semanticAnchorScope?: string }} SemanticColorResolverInput
 * @typedef {{ enabled?: boolean, overrides?: Partial<Record<TrackedChangeSemanticColorKey, string>>, resolve?: (input: SemanticColorResolverInput) => (string | undefined) }} SemanticColorsConfig
 * @typedef {{ visible: boolean, mode: TrackChangesMode, enabled: boolean, replacements: InternalTrackChangesReplacementMode, authorColors?: AuthorColorsConfig, semanticColors?: SemanticColorsConfig }} NormalizedTrackChangesConfig
 */

/** @type {ReadonlyArray<TrackChangesMode>} */
const ALLOWED_MODES = ['review', 'original', 'final', 'off'];
/** @type {ReadonlyArray<ViewingTrackedChangesMode>} */
const ALLOWED_VIEWING_MODES = ['original', 'markup', 'final'];

/** @type {ReadonlyArray<InternalTrackChangesReplacementMode>} */
const INTERNAL_REPLACEMENT_MODES = ['paired', 'independent'];

// Marks a config object we've already normalized so a second pass with the same
// object (e.g. a consumer reusing the config to mount another SuperDoc) doesn't
// warn on the legacy keys we wrote back during the first pass.
const NORMALIZED_MARKER = Symbol.for('@superdoc/trackChanges:normalized');

/** @type {Set<string>} */
const warnedKeys = new Set();

/**
 * @param {string} legacyPath
 * @param {string} newPath
 */
function warnOnce(legacyPath, newPath) {
  if (warnedKeys.has(legacyPath)) return;
  warnedKeys.add(legacyPath);
  console.warn(`[SuperDoc] ${legacyPath} is deprecated — use ${newPath} instead.`);
}

/**
 * @param {unknown} newVal
 * @param {unknown} legacyVal
 * @param {boolean} fallback
 * @returns {boolean}
 */
function resolveBool(newVal, legacyVal, fallback) {
  if (typeof newVal === 'boolean') return newVal;
  if (typeof legacyVal === 'boolean') return legacyVal;
  return fallback;
}

/**
 * @param {unknown} newVal
 * @param {unknown} legacyVal
 * @param {TrackChangesMode} fallback
 * @returns {TrackChangesMode}
 */
function resolveMode(newVal, legacyVal, fallback) {
  if (typeof newVal === 'string' && ALLOWED_MODES.includes(/** @type {TrackChangesMode} */ (newVal))) {
    return /** @type {TrackChangesMode} */ (newVal);
  }
  if (typeof legacyVal === 'string' && ALLOWED_MODES.includes(/** @type {TrackChangesMode} */ (legacyVal))) {
    return /** @type {TrackChangesMode} */ (legacyVal);
  }
  return fallback;
}

/**
 * @param {unknown} value
 * @returns {ViewingTrackedChangesMode | null}
 */
function resolveViewingMode(value) {
  if (typeof value !== 'string' || !ALLOWED_VIEWING_MODES.includes(/** @type {ViewingTrackedChangesMode} */ (value))) {
    return null;
  }
  return /** @type {ViewingTrackedChangesMode} */ (value);
}

/**
 * @param {ViewingTrackedChangesMode} value
 * @returns {TrackChangesMode}
 */
function viewingModeToRenderMode(value) {
  return value === 'markup' ? 'review' : value;
}

/**
 * @param {unknown} value
 * @returns {InternalTrackChangesReplacementMode | null}
 */
function coerceInternalReplacementMode(value) {
  if (
    typeof value === 'string' &&
    INTERNAL_REPLACEMENT_MODES.includes(/** @type {InternalTrackChangesReplacementMode} */ (value))
  ) {
    return /** @type {InternalTrackChangesReplacementMode} */ (value);
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {InternalTrackChangesReplacementMode | null}
 */
function replacementModeToInternal(value) {
  if (value === 'grouped') return 'paired';
  if (value === 'separate') return 'independent';
  return null;
}

/**
 * @param {InternalTrackChangesReplacementMode} value
 * @returns {TrackChangesReplacementMode}
 */
function replacementModeToPublic(value) {
  return value === 'paired' ? 'grouped' : 'separate';
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function pickObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Resolves tracked-change behavior from `config.trackChanges` and viewer
 * projection from `config.viewing.trackedChanges`. The normalized result is
 * mirrored to the previous paths while their internal consumers migrate.
 *
 * Precedence per field: canonical > legacy > derived default.
 *
 * Emits a one-time deprecation warning per legacy key path that was
 * populated by the caller. Suppresses warnings on a second pass over the
 * same config object so write-through values don't look like new legacy
 * usage.
 *
 * @param {Record<string, any>} config  The SuperDoc config object (mutated in place)
 * @returns {NormalizedTrackChangesConfig}
 */
export function normalizeTrackChangesConfig(config) {
  const alreadyNormalized = /** @type {Record<symbol, unknown>} */ (config)[NORMALIZED_MARKER] === true;
  const fromViewing = pickObject(config.viewing);
  const viewingMode = resolveViewingMode(fromViewing?.trackedChanges);

  if (!pickObject(config.modules)) {
    config.modules = {};
  }

  const fromCanonical = pickObject(config.trackChanges);
  const fromLegacyModule = pickObject(config.modules.trackChanges);
  const fromLegacyLayout = pickObject(config.layoutEngineOptions?.trackedChanges);

  if (!alreadyNormalized) {
    if (fromCanonical && Object.prototype.hasOwnProperty.call(fromCanonical, 'visible')) {
      warnOnce('config.trackChanges.visible', 'config.viewing.trackedChanges');
    }
    if (fromLegacyModule) {
      warnOnce(
        'config.modules.trackChanges',
        'config.trackChanges for behavior and config.viewing.trackedChanges for viewing projection',
      );
    }
    if (fromLegacyLayout) {
      warnOnce(
        'config.layoutEngineOptions.trackedChanges',
        'config.viewing.trackedChanges for display and config.trackChanges.enabled for behavior',
      );
    }
  }

  const visible = viewingMode
    ? viewingMode === 'markup'
    : resolveBool(fromCanonical?.visible, fromLegacyModule?.visible, false);

  const enabled = resolveBool(
    fromCanonical?.enabled,
    fromLegacyModule?.enabled,
    typeof fromLegacyLayout?.enabled === 'boolean' ? fromLegacyLayout.enabled : true,
  );

  const internalReplacementMode =
    replacementModeToInternal(fromCanonical?.replacementMode) ??
    coerceInternalReplacementMode(fromLegacyModule?.replacements) ??
    'paired';

  // Preserve color config by reference because either object may carry a
  // resolver function that the composed resolver must keep intact.
  const authorColorsSource = pickObject(fromCanonical?.authorColors) ?? pickObject(fromLegacyModule?.authorColors);
  const authorColors = authorColorsSource ? /** @type {AuthorColorsConfig} */ (authorColorsSource) : undefined;

  const semanticColorsSource =
    pickObject(fromCanonical?.semanticColors) ?? pickObject(fromLegacyModule?.semanticColors);
  const semanticColors = semanticColorsSource ? /** @type {SemanticColorsConfig} */ (semanticColorsSource) : undefined;

  // Default mode derives from documentMode + visibility so a viewing-mode
  // document without an explicit mode falls back to 'original' unless the
  // consumer asked for tracked changes to be visible.
  const isViewingMode = config.documentMode === 'viewing';
  /** @type {TrackChangesMode} */
  const defaultMode = isViewingMode ? (visible ? 'review' : 'original') : 'review';
  const mode = viewingMode
    ? isViewingMode
      ? viewingModeToRenderMode(viewingMode)
      : 'review'
    : resolveMode(fromLegacyModule?.mode, fromLegacyLayout?.mode, defaultMode);

  /** @type {NormalizedTrackChangesConfig} */
  const normalized = { visible, mode, enabled, replacements: internalReplacementMode };
  if (authorColors) {
    normalized.authorColors = authorColors;
  }
  if (semanticColors) {
    normalized.semanticColors = semanticColors;
  }

  // Write-through to every path so all existing internal reads see the same
  // resolved values without needing to migrate each call site in this pass.
  config.modules.trackChanges = normalized;
  config.trackChanges = { visible, enabled, replacementMode: replacementModeToPublic(internalReplacementMode) };
  if (authorColors) {
    config.trackChanges.authorColors = authorColors;
  }
  if (semanticColors) {
    config.trackChanges.semanticColors = semanticColors;
  }
  if (!pickObject(config.layoutEngineOptions)) {
    config.layoutEngineOptions = {};
  }
  config.layoutEngineOptions.trackedChanges = { mode, enabled };

  if (typeof fromViewing?.comments === 'boolean') {
    if (!pickObject(config.comments)) config.comments = {};
    config.comments.visible = fromViewing.comments;
  }

  Object.defineProperty(config, NORMALIZED_MARKER, {
    value: true,
    writable: true,
    configurable: true,
    enumerable: false,
  });

  return normalized;
}

/**
 * Test-only hook: clears the deduplicated deprecation-warning set so
 * tests can assert the warning fires on the first invocation.
 */
export function __resetDeprecationWarnings() {
  warnedKeys.clear();
}
