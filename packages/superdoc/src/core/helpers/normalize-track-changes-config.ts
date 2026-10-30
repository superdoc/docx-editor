import type {
  Config,
  TrackChangesModuleConfig,
  TrackChangesReplacementMode,
  ViewingTrackedChangesMode,
} from '../types/index.js';

type TrackChangesMode = NonNullable<TrackChangesModuleConfig['mode']>;
type InternalTrackChangesReplacementMode = NonNullable<TrackChangesModuleConfig['replacements']>;

type TrackChangesConfigSource = Pick<
  Config,
  'documentMode' | 'viewing' | 'modules' | 'trackChanges' | 'layoutEngineOptions' | 'comments'
>;

type NormalizedTrackChangesConfig = Required<
  Pick<TrackChangesModuleConfig, 'visible' | 'mode' | 'enabled' | 'replacements'>
> &
  Pick<TrackChangesModuleConfig, 'authorColors' | 'semanticColors'>;

const ALLOWED_MODES: ReadonlyArray<TrackChangesMode> = ['review', 'original', 'final', 'off'];
const ALLOWED_VIEWING_MODES: ReadonlyArray<ViewingTrackedChangesMode> = ['original', 'markup', 'final'];
const INTERNAL_REPLACEMENT_MODES: ReadonlyArray<InternalTrackChangesReplacementMode> = ['paired', 'independent'];

const NORMALIZED_MARKER: unique symbol = Symbol.for('@superdoc/trackChanges:normalized');

const warnedKeys = new Set<string>();

function warnOnce(legacyPath: string, newPath: string): void {
  if (warnedKeys.has(legacyPath)) return;
  warnedKeys.add(legacyPath);
  console.warn(`[SuperDoc] ${legacyPath} is deprecated — use ${newPath} instead.`);
}

function resolveBool(newVal: unknown, legacyVal: unknown, fallback: boolean): boolean {
  if (typeof newVal === 'boolean') return newVal;
  if (typeof legacyVal === 'boolean') return legacyVal;
  return fallback;
}

function findAllowed<T extends string>(allowed: ReadonlyArray<T>, value: unknown): T | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

function resolveMode(newVal: unknown, legacyVal: unknown, fallback: TrackChangesMode): TrackChangesMode {
  return findAllowed(ALLOWED_MODES, newVal) ?? findAllowed(ALLOWED_MODES, legacyVal) ?? fallback;
}

function viewingModeToRenderMode(value: ViewingTrackedChangesMode): TrackChangesMode {
  return value === 'markup' ? 'review' : value;
}

function replacementModeToInternal(value: unknown): InternalTrackChangesReplacementMode | null {
  if (value === 'grouped') return 'paired';
  if (value === 'separate') return 'independent';
  return null;
}

function replacementModeToPublic(value: InternalTrackChangesReplacementMode): TrackChangesReplacementMode {
  return value === 'paired' ? 'grouped' : 'separate';
}

function pickObject<T>(value: T | null | undefined): T | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function readKey(source: object | null, key: string): unknown {
  return source ? Reflect.get(source, key) : undefined;
}

export function normalizeTrackChangesConfig(config: TrackChangesConfigSource): NormalizedTrackChangesConfig {
  const alreadyNormalized = NORMALIZED_MARKER in config && config[NORMALIZED_MARKER] === true;
  const fromViewing = pickObject(config.viewing);
  const viewingMode = findAllowed(ALLOWED_VIEWING_MODES, fromViewing?.trackedChanges);

  let modules = pickObject(config.modules);
  if (!modules) {
    modules = {};
    config.modules = modules;
  }

  const fromCanonical = pickObject(config.trackChanges);
  const fromLegacyModule = pickObject(modules.trackChanges);
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
    resolveBool(readKey(fromLegacyLayout, 'enabled'), undefined, true),
  );

  const internalReplacementMode =
    replacementModeToInternal(fromCanonical?.replacementMode) ??
    findAllowed(INTERNAL_REPLACEMENT_MODES, fromLegacyModule?.replacements) ??
    'paired';

  const authorColors =
    pickObject(fromCanonical?.authorColors) ?? pickObject(fromLegacyModule?.authorColors) ?? undefined;
  const semanticColors =
    pickObject(fromCanonical?.semanticColors) ?? pickObject(fromLegacyModule?.semanticColors) ?? undefined;

  const isViewingMode = config.documentMode === 'viewing';
  const defaultMode: TrackChangesMode = isViewingMode ? (visible ? 'review' : 'original') : 'review';
  const mode = viewingMode
    ? isViewingMode
      ? viewingModeToRenderMode(viewingMode)
      : 'review'
    : resolveMode(fromLegacyModule?.mode, readKey(fromLegacyLayout, 'mode'), defaultMode);

  const normalized: NormalizedTrackChangesConfig = { visible, mode, enabled, replacements: internalReplacementMode };
  if (authorColors) {
    normalized.authorColors = authorColors;
  }
  if (semanticColors) {
    normalized.semanticColors = semanticColors;
  }

  modules.trackChanges = normalized;
  config.trackChanges = { visible, enabled, replacementMode: replacementModeToPublic(internalReplacementMode) };
  if (authorColors) {
    config.trackChanges.authorColors = authorColors;
  }
  if (semanticColors) {
    config.trackChanges.semanticColors = semanticColors;
  }
  let layoutEngineOptions = pickObject(config.layoutEngineOptions);
  if (!layoutEngineOptions) {
    layoutEngineOptions = {};
    config.layoutEngineOptions = layoutEngineOptions;
  }
  layoutEngineOptions.trackedChanges = { mode, enabled };

  if (typeof fromViewing?.comments === 'boolean') {
    let comments = pickObject(config.comments);
    if (!comments) {
      comments = {};
      config.comments = comments;
    }
    comments.visible = fromViewing.comments;
  }

  Object.defineProperty(config, NORMALIZED_MARKER, {
    value: true,
    writable: true,
    configurable: true,
    enumerable: false,
  });

  return normalized;
}

export function __resetDeprecationWarnings(): void {
  warnedKeys.clear();
}
