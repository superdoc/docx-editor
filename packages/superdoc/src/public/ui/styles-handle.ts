import type { FormatReadSelectionResult } from '@superdoc/document-api';
import { isObjectRecord } from '../../helpers/object-guards.js';
import type { AsyncReadEntry } from './async-read-cache.js';
import { failedReceipt, resolveDocOperation, safeCall } from './command-results.js';
import { storyLocatorSignature } from './entity-rows.js';
import { selectionKey } from './format-painter-helpers.js';
import { combineStatus } from './heavy-read-policy.js';
import { readRecord, type LooseRecord } from './loose-record.js';
import { canProbeEverySelectedBlock, selectionBlockIds, selectionStory } from './selection-targets.js';
import { buildStyleMatchPatch, STYLE_MATCH_READ_KEYS } from './style-match-patch.js';
import type {
  ActiveParagraphStyle,
  SelectionSlice,
  SliceStatus,
  SnapshotSubscribable,
  StyleCatalogDiagnostic,
  StyleCatalogItem,
  StylesGetCatalogInput,
  StylesGetCatalogResult,
  StylesHandle,
  StylesSlice,
  StylesUpdateToMatchSelectionInput,
  Subscribable,
  SuperDocUIFailureReceipt,
  SuperDocUIState,
  WorkflowReceipt,
} from './types.js';

export const WORD_DEFAULT_PARAGRAPH_STYLE_ID = 'Normal';

export type StyleCatalogCache = {
  full: StylesGetCatalogResult;
  quickGallery: readonly StyleCatalogItem[];
  byId: Map<string, StyleCatalogItem>;
};

export interface StyleCatalogRead {
  cache: StyleCatalogCache | null;
  status: SliceStatus;
}

export interface ActiveParagraphStyleRead {
  style: ActiveParagraphStyle;
  status: SliceStatus;
}

interface AsyncRead<T> {
  value: T | null;
  status: SliceStatus;
}

export interface StyleReadsDeps {
  hasEditor: () => boolean;
  getDoc: () => LooseRecord | null;
  contentToken: () => string;
  readAsync: <T>(key: string, token: string, run: () => unknown, normalize: (raw: unknown) => T | null) => AsyncRead<T>;
  readNodeById: (doc: LooseRecord | null, blockId: string, story: LooseRecord) => AsyncRead<LooseRecord>;
}

export interface StyleReads {
  readCatalog: (input?: StylesGetCatalogInput) => AsyncRead<StylesGetCatalogResult>;
  catalog: () => StyleCatalogRead;
  activeParagraphStyle: (selection: SelectionSlice) => ActiveParagraphStyleRead;
  computeSlice: (selection: SelectionSlice) => StylesSlice;
}

export interface StylesHandleDeps {
  reads: StyleReads;
  select: (selector: (state: Pick<SuperDocUIState, 'styles'>) => StylesSlice) => Subscribable<StylesSlice>;
  snapshotHandle: (sub: Subscribable<StylesSlice>) => SnapshotSubscribable<StylesSlice>;
  currentSelection: () => SelectionSlice;
  isDisposed: () => boolean;
  getDoc: () => LooseRecord | null;
  contentToken: () => string;
  demandHeavyDocRead: (key: string) => void;
  readAsyncEntry: (key: string) => AsyncReadEntry | undefined;
  readDocumentMode: () => SuperDocUIState['documentMode'];
  readHostSelectionSnapshot: () => object | null;
  readSelectionInfoFresh: () => Promise<SelectionSlice>;
  settleWorkflowReceipt: (receipt: unknown, fallback: SuperDocUIFailureReceipt) => WorkflowReceipt;
}

type BlockStyleRead =
  | { readable: true; styleRef: string | null; status: SliceStatus }
  | { readable: false; status: SliceStatus };

export function styleCatalogReadKey(input?: StylesGetCatalogInput): string {
  return `styles:catalog:${JSON.stringify(input ?? {})}`;
}

export function documentDefaultParagraphStyleId(catalog: StyleCatalogCache | null): string {
  return catalog?.full.defaults.paragraphStyleId ?? WORD_DEFAULT_PARAGRAPH_STYLE_ID;
}

function isStyleCatalogResult(value: unknown): value is StylesGetCatalogResult {
  return (
    isObjectRecord(value) &&
    Array.isArray(value.styles) &&
    Array.isArray(value.items) &&
    isObjectRecord(value.defaults) &&
    Array.isArray(value.diagnostics)
  );
}

function isFormatReadResultCarrier(value: unknown): value is FormatReadSelectionResult {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function requireFormatReadResult(value: unknown): FormatReadSelectionResult {
  if (!isFormatReadResultCarrier(value)) throw new TypeError('format.readSelection returned no result');
  return value;
}

function emptyStylesSlice(): StylesSlice {
  return {
    ready: false,
    status: 'ready',
    catalogRevision: null,
    quickGallery: [],
    activeParagraphStyleId: null,
    activeParagraphStyleName: null,
    mixedSelection: false,
    sourceStatus: null,
    diagnostics: [],
  };
}

function unresolvedStyle(diagnostics: StyleCatalogDiagnostic[], status: SliceStatus): ActiveParagraphStyleRead {
  return { style: { styleId: null, styleName: null, mixed: false, diagnostics }, status };
}

function catalogDiagnosticsWith(
  catalogDiagnostics: readonly StyleCatalogDiagnostic[],
  activeDiagnostics: readonly StyleCatalogDiagnostic[],
): readonly StyleCatalogDiagnostic[] {
  return activeDiagnostics.length === 0 ? catalogDiagnostics : [...catalogDiagnostics, ...activeDiagnostics];
}

function readMember(value: unknown, key: string): unknown {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? Reflect.get(value, key)
    : undefined;
}

function callMethod(target: unknown, name: string, input: unknown): unknown {
  const method = readMember(target, name);
  if (typeof method !== 'function') throw new TypeError(`${name} is not callable`);
  return Reflect.apply(method, target, [input]);
}

function readHostSelectionPositionKey(snapshot: LooseRecord | undefined): string | null {
  if (!snapshot) return null;
  return JSON.stringify({
    story: snapshot.story,
    tableCells: snapshot.tableCells,
    points: ['anchor', 'focus'].map((side) => {
      const point = snapshot[side];
      if (!point) return null;
      return [
        'blockId',
        'blockOffset',
        'trackedBlockOffset',
        'story',
        'inlineAffinity',
        'outsideContentControl',
        'visualCaret',
      ].map((field) => readMember(point, field));
    }),
  });
}

export function createStyleReads(deps: StyleReadsDeps): StyleReads {
  const emptySlice = emptyStylesSlice();

  const readCatalog = (input?: StylesGetCatalogInput): AsyncRead<StylesGetCatalogResult> => {
    const stylesApi = deps.getDoc()?.styles;
    if (!stylesApi || typeof readMember(stylesApi, 'getCatalog') !== 'function')
      return { value: null, status: 'ready' };
    return deps.readAsync<StylesGetCatalogResult>(
      styleCatalogReadKey(input),
      deps.contentToken(),
      () => callMethod(stylesApi, 'getCatalog', input),
      (raw) => (isStyleCatalogResult(raw) ? raw : null),
    );
  };

  const catalog = (): StyleCatalogRead => {
    const full = readCatalog({ includePreview: true });
    if (!full.value) return { cache: null, status: full.status };
    const quickView = readCatalog({ view: 'quickGallery', includePreview: true });
    const quickGallery: readonly StyleCatalogItem[] = quickView.value
      ? quickView.value.items
      : full.value.styles.filter((item) => item.visibility.quickGallery);
    const byId = new Map<string, StyleCatalogItem>();
    for (const item of full.value.styles) byId.set(item.id, item);
    return {
      cache: { full: full.value, quickGallery, byId },
      status: combineStatus(full.status, quickView.status),
    };
  };

  const readBlockStyleRef = (doc: LooseRecord | null, blockId: string, story: LooseRecord): BlockStyleRead => {
    const { value: result, status } = deps.readNodeById(doc, blockId, story);
    const node = readRecord(result?.node);
    if (!node) return { readable: false, status };
    const kind = node.kind;
    const payload = typeof kind === 'string' ? readRecord(node[kind]) : undefined;
    const raw = payload?.styleRef;
    const styleRef = typeof raw === 'string' && raw.length > 0 ? raw : null;
    return { readable: true, styleRef, status };
  };

  const resolveActiveParagraphStyle = (
    selection: SelectionSlice,
    cache: StyleCatalogCache | null,
  ): ActiveParagraphStyleRead => {
    const doc = deps.getDoc();
    if (!doc) {
      return unresolvedStyle(
        [
          {
            severity: 'warning',
            code: 'active-style-unavailable',
            message: 'Active paragraph style is unavailable: the Document API is not reachable.',
          },
        ],
        'ready',
      );
    }
    const blockIds = selectionBlockIds(selection);
    if (blockIds.length === 0) {
      return unresolvedStyle(
        [
          {
            severity: 'info',
            code: 'active-style-no-selection',
            message:
              'No paragraph block is resolvable from the current selection; active paragraph style is unavailable.',
          },
        ],
        'ready',
      );
    }
    if (!canProbeEverySelectedBlock(blockIds)) {
      return unresolvedStyle(
        [
          {
            severity: 'info',
            code: 'active-style-selection-too-large',
            message: 'Active paragraph style is unavailable for a large multi-paragraph selection.',
          },
        ],
        'ready',
      );
    }
    const defaultId = cache ? documentDefaultParagraphStyleId(cache) : null;
    const resolvedIds = new Set<string>();
    let resolved = 0;
    let blockReadFailures = 0;
    let defaultReadFailures = 0;
    let readStatus: SliceStatus = 'ready';
    const story = selectionStory(selection);
    for (const blockId of blockIds) {
      const read = readBlockStyleRef(doc, blockId, story);
      readStatus = combineStatus(readStatus, read.status);
      if (!read.readable) {
        blockReadFailures += 1;
        continue;
      }
      const styleId = read.styleRef ?? defaultId;
      if (!styleId) {
        defaultReadFailures += 1;
        continue;
      }
      resolved += 1;
      resolvedIds.add(styleId);
    }
    if (resolved === 0) {
      const onlyDefaultUnavailable = defaultReadFailures > 0 && blockReadFailures === 0;
      return unresolvedStyle(
        [
          {
            severity: 'warning',
            code: onlyDefaultUnavailable ? 'active-style-default-unavailable' : 'active-style-read-failed',
            message: onlyDefaultUnavailable
              ? 'Selected paragraphs have no explicit style and the style catalogue is unavailable, so the document default cannot be resolved.'
              : 'Could not read the paragraph style of any selected block; active paragraph style is unavailable.',
          },
        ],
        readStatus,
      );
    }
    const unresolved = blockReadFailures + defaultReadFailures;
    if (unresolved > 0) {
      return unresolvedStyle(
        [
          {
            severity: 'warning',
            code: 'active-style-partial',
            message: `Active paragraph style resolved from ${resolved} of ${resolved + unresolved} selected blocks; ${unresolved} could not be read, so the active style is unavailable.`,
          },
        ],
        readStatus,
      );
    }
    if (resolvedIds.size > 1) {
      return { style: { styleId: null, styleName: null, mixed: true, diagnostics: [] }, status: readStatus };
    }
    const [styleId] = resolvedIds;
    const styleName = cache?.byId.get(styleId)?.name ?? null;
    return { style: { styleId, styleName, mixed: false, diagnostics: [] }, status: readStatus };
  };

  const activeParagraphStyle = (selection: SelectionSlice): ActiveParagraphStyleRead =>
    resolveActiveParagraphStyle(selection, catalog().cache);

  const computeSlice = (selection: SelectionSlice): StylesSlice => {
    if (!deps.hasEditor()) return emptySlice;
    const { cache, status: catalogStatus } = catalog();
    const { style: active, status: activeStatus } = resolveActiveParagraphStyle(selection, cache);
    const diagnostics: readonly StyleCatalogDiagnostic[] = cache
      ? catalogDiagnosticsWith(cache.full.diagnostics, active.diagnostics)
      : [
          {
            severity: 'warning',
            code: 'catalog-unavailable',
            message:
              'The style catalogue is unavailable: the Document API styles surface is not reachable (e.g. viewing mode or a worker-backed editor).',
          },
          ...active.diagnostics,
        ];
    return {
      ready: true,
      status: combineStatus(catalogStatus, activeStatus, selection.status),
      catalogRevision: cache?.full.revision ?? null,
      quickGallery: cache?.quickGallery ?? [],
      activeParagraphStyleId: active.styleId,
      activeParagraphStyleName: active.styleName,
      mixedSelection: active.mixed,
      sourceStatus: cache?.full.sourceStatus ?? null,
      diagnostics,
    };
  };

  return { readCatalog, catalog, activeParagraphStyle, computeSlice };
}

export function createStylesHandle(deps: StylesHandleDeps): StylesHandle {
  const { reads } = deps;

  const updateToMatchSelection = (input?: StylesUpdateToMatchSelectionInput): WorkflowReceipt => {
    const mode = deps.readDocumentMode();
    if (mode === 'viewing') return failedReceipt('The document is read-only.', 'DOCUMENT_READONLY');
    if (mode === 'suggesting') {
      return failedReceipt('A style definition cannot be changed as a tracked suggestion.', 'PRECONDITION_FAILED');
    }
    const sourceToken = deps.contentToken();
    const readPositionKey = (): string | null =>
      readHostSelectionPositionKey(readRecord(deps.readHostSelectionSnapshot()));
    const requestedPosition = readPositionKey();
    const stale = failedReceipt('The selection or document changed while reading its style.', 'REVISION_MISMATCH');
    return deps.readSelectionInfoFresh().then((selection) => {
      const selectionToken = selectionKey(selection);
      const isCurrent = (): boolean =>
        !deps.isDisposed() &&
        deps.contentToken() === sourceToken &&
        readPositionKey() === requestedPosition &&
        selectionKey(deps.currentSelection()) === selectionToken &&
        deps.readDocumentMode() === mode;
      if (!isCurrent()) return stale;
      const story = storyLocatorSignature(selectionStory(selection));
      const keys = [
        styleCatalogReadKey({ includePreview: true }),
        ...selectionBlockIds(selection).map((id) => `node:${story}:${id}`),
      ];
      for (const key of keys) deps.demandHeavyDocRead(key);
      const active = reads.activeParagraphStyle(selection).style;
      const unreadable = failedReceipt('The selection formatting could not be read.', 'PRECONDITION_FAILED');
      const run = (active: ActiveParagraphStyle): WorkflowReceipt => {
        const unavailable = keys.some((key) => {
          const entry = deps.readAsyncEntry(key);
          return entry && (!entry.hasSettled || entry.token !== sourceToken || entry.failedToken === sourceToken);
        });
        if (unavailable) return unreadable;
        const styleId = input?.styleId ?? active.styleId;
        if (!styleId) {
          return failedReceipt(
            'Choose a style to update: the selection does not have a single paragraph style.',
            'INVALID_TARGET',
          );
        }
        const doc = deps.getDoc();
        const readSelection = resolveDocOperation(doc, 'format.readSelection');
        const apply = resolveDocOperation(doc, 'styles.apply');
        if (!readSelection || !apply) return failedReceipt('Updating a style to match the selection is unavailable.');
        let formatReads: [unknown, unknown];
        try {
          formatReads = [
            readSelection({ selection: 'current', keys: STYLE_MATCH_READ_KEYS, view: 'effective' }),
            readSelection({ selection: 'current', keys: STYLE_MATCH_READ_KEYS, view: 'direct' }),
          ];
        } catch {
          return unreadable;
        }
        return Promise.all(formatReads).then(
          ([effective, direct]) => {
            if (!isCurrent()) return stale;
            const patch = buildStyleMatchPatch(requireFormatReadResult(effective), requireFormatReadResult(direct), {
              selectionUsesStyle: !active.mixed && active.styleId === styleId,
            });
            if (Object.keys(patch).length === 0)
              return failedReceipt('The selection already matches the style.', 'NO_OP');
            const fallback = failedReceipt('Updating the style failed.');
            return safeCall<WorkflowReceipt>(
              () =>
                deps.settleWorkflowReceipt(
                  apply({ target: { scope: 'style', styleId, channel: 'run' }, patch }),
                  fallback,
                ),
              fallback,
            );
          },
          () => unreadable,
        );
      };
      const pending = keys.flatMap((key) => {
        const entry = deps.readAsyncEntry(key);
        return entry?.inflightToken === sourceToken && entry.settled ? [entry.settled] : [];
      });
      if (pending.length === 0) return run(active);
      return Promise.all(pending).then(() => {
        if (!isCurrent()) return stale;
        return run(reads.activeParagraphStyle(selection).style);
      });
    });
  };

  const sub = deps.select((s) => s.styles);
  const snap = deps.snapshotHandle(sub);
  return {
    get: snap.get,
    getSnapshot: snap.getSnapshot,
    subscribe: snap.subscribe,
    observe: snap.observe,
    getCatalog: (options?: StylesGetCatalogInput): StylesGetCatalogResult | null => {
      deps.demandHeavyDocRead(styleCatalogReadKey(options));
      return reads.readCatalog(options).value;
    },
    getQuickGallery: (): readonly StyleCatalogItem[] => sub.get().quickGallery,
    getActiveParagraphStyle: (): ActiveParagraphStyle => reads.activeParagraphStyle(deps.currentSelection()).style,
    updateToMatchSelection,
  };
}
