import { isFiniteNumber } from '../../helpers/is-finite-number.js';
import { isObjectRecord, isPlainObject } from '../../helpers/object-guards.js';
import { hostMethod, isPromiseLike, safeCall } from './command-results.js';
import { SUPERDOC_UI_REASONS } from './reasons.js';
import type {
  SearchController,
  SearchQueryOptions,
  SearchSnapshot,
  SnapshotSubscribable,
  Subscribable,
  WorkflowActionResult,
} from './types.js';

type SearchFacade = Record<string, unknown>;

export type SearchCommandId = 'find.replace' | 'find.replaceAll';

export interface SearchCommandState {
  enabled?: unknown;
  reason?: unknown;
}

export interface SearchHandleDeps {
  hostSearch: () => unknown;
  editCommandSearch: () => unknown;
  editCommandState: (commandId: SearchCommandId) => SearchCommandState | null;
  snapshotHandle: (sub: Subscribable<SearchSnapshot>) => SnapshotSubscribable<SearchSnapshot>;
  isDisposed: () => boolean;
  onDocumentReset: (hook: () => void) => void;
  onDocumentModeChange: (hook: () => void) => void;
}

export interface SearchHandleController {
  handle: SearchController;
  scheduleRefresh: () => void;
  stopRefresh: () => void;
  clearListeners: () => void;
  invalidateInFlightRequests: () => void;
}

interface NormalizedSearchResult {
  query?: string;
  total: number;
  activeIndex: number;
  canReplace: boolean;
  canReplaceAll: boolean;
  caseSensitive?: boolean;
  includeDeletedText?: boolean;
  regex?: boolean;
  invalidPattern?: boolean;
}

export const SEARCH_REFRESH_DELAY_MS = 120;

const SEARCH_UNAVAILABLE_SLICE: SearchSnapshot = {
  query: '',
  total: 0,
  activeIndex: -1,
  open: false,
  available: false,
  caseSensitive: false,
  includeTrackedDeletions: false,
  includeDeletedText: false,
  regex: false,
  canReplace: false,
  canReplaceAll: false,
  reason: SUPERDOC_UI_REASONS.searchUnavailable,
};

function hasInvalidPatternCode(value: unknown): boolean {
  return isObjectRecord(value) && value.code === 'invalid-pattern';
}

function readSearchQueryError(record: SearchFacade | null): boolean {
  if (!record) return false;
  if (hasInvalidPatternCode(record.queryError)) return true;
  const rejection = record.rejection;
  return record.status === 'rejected' && hasInvalidPatternCode(rejection);
}

function readActiveIndex(record: SearchFacade): number {
  if (typeof record.activeMatchIndex === 'number') return record.activeMatchIndex;
  if (typeof record.activeIndex === 'number') return record.activeIndex;
  return -1;
}

function normalizeHostSearchResult(
  result: unknown,
  fallbackCanReplace = false,
  fallbackCanReplaceAll = fallbackCanReplace,
): NormalizedSearchResult | null {
  const record = isObjectRecord(result) ? result : null;
  if (!record) return null;
  const matches = Array.isArray(record.matches) ? record.matches : [];
  const total = isFiniteNumber(record.total) ? record.total : matches.length;
  const activeIndex = readActiveIndex(record);
  const canReplace = record.canReplace === true || fallbackCanReplace;
  return {
    ...(typeof record.query === 'string' ? { query: record.query } : {}),
    total,
    activeIndex,
    canReplace,
    canReplaceAll:
      canReplace && total > 0 && record.truncated !== true && (record.canReplace === true || fallbackCanReplaceAll),
    ...(typeof record.caseSensitive === 'boolean' ? { caseSensitive: record.caseSensitive } : {}),
    ...(typeof record.includeDeletedText === 'boolean' ? { includeDeletedText: record.includeDeletedText } : {}),
    ...(record.regex === true ? { regex: true } : {}),
    ...(readSearchQueryError(record) ? { invalidPattern: true } : {}),
  };
}

function hasCode(value: unknown, code: string): boolean {
  return isObjectRecord(value) && value.code === code;
}

function mapHostReplaceResult(result: unknown): WorkflowActionResult {
  const record = isObjectRecord(result) ? result : null;
  if (record?.status === 'committed') return { ok: true };
  if (record?.status === 'rejected' && record.reason === 'read-only') {
    return { ok: false, reason: SUPERDOC_UI_REASONS.documentReadonly };
  }
  const rejection = record?.rejection;
  if (record?.status === 'rejected' && hasCode(rejection, 'read-only-document')) {
    return { ok: false, reason: SUPERDOC_UI_REASONS.documentReadonly };
  }
  if (record?.status === 'rejected' && record.reason === 'truncated') {
    return { ok: false, reason: SUPERDOC_UI_REASONS.searchTruncated };
  }
  const failure = record?.failure;
  if (record?.status === 'receipt-failure' && hasCode(failure, 'REVISION_MISMATCH')) {
    return { ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved };
  }
  return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
}

function replacementText(replacement: unknown): string {
  return typeof replacement === 'string' ? replacement : '';
}

export function createSearchHandle(deps: SearchHandleDeps): SearchHandleController {
  let searchState: SearchSnapshot = { ...SEARCH_UNAVAILABLE_SLICE };
  const searchListeners = new Set<(slice: SearchSnapshot) => void>();

  const getHostSearch = (): SearchFacade | null => {
    const search = deps.hostSearch();
    return isPlainObject(search) ? search : null;
  };
  const getEditCommandSearch = (): SearchFacade | null => {
    const search = deps.editCommandSearch();
    return isPlainObject(search) ? search : null;
  };
  const searchIsAvailable = (): boolean => {
    const search = getHostSearch();
    if (search && typeof search.setSession === 'function') return true;
    const editSearch = getEditCommandSearch();
    return editSearch !== null && typeof editSearch.query === 'function' && typeof editSearch.getState === 'function';
  };
  const emitSearch = (): void => {
    for (const listener of [...searchListeners]) safeCall(() => listener(searchState), undefined);
  };
  const setSearchState = (patch: Partial<SearchSnapshot>): SearchSnapshot => {
    searchState = { ...searchState, ...patch };
    const includeTrackedDeletions = patch.includeTrackedDeletions ?? patch.includeDeletedText;
    if (includeTrackedDeletions !== undefined) {
      searchState.includeTrackedDeletions = includeTrackedDeletions;
      searchState.includeDeletedText = includeTrackedDeletions;
    }
    emitSearch();
    return searchState;
  };

  let searchRequestGeneration = 0;
  let pendingFallbackGeneration: number | null = null;
  let completedFallbackSearch: SearchFacade | null = null;
  let shellFallbackOutstanding = false;
  let searchRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let releaseActiveSearchSession: (() => void) | null = null;
  let releaseRefreshShellSearch: (() => void) | null = null;

  const cancelRefreshShellSearch = (): void => {
    const release = releaseRefreshShellSearch;
    releaseRefreshShellSearch = null;
    if (release) safeCall<unknown>(() => release(), null);
  };

  const releaseSearchSession = (): void => {
    const release = releaseActiveSearchSession;
    releaseActiveSearchSession = null;
    if (!release) return;
    safeCall<unknown>(() => {
      release();
      return null;
    }, null);
  };

  const cancelOutstandingShellFallback = (): void => {
    if (!shellFallbackOutstanding) return;
    shellFallbackOutstanding = false;
    const editSearch = getEditCommandSearch();
    if (editSearch && typeof editSearch.query === 'function') {
      safeCall<unknown>(() => hostMethod(editSearch, 'query')?.({ query: '' }), null);
    }
  };

  const readEditCommandCanReplace = (): boolean =>
    pendingFallbackGeneration !== searchRequestGeneration && deps.editCommandState('find.replace')?.enabled === true;
  const readEditCommandCanReplaceAll = (): boolean =>
    pendingFallbackGeneration !== searchRequestGeneration && deps.editCommandState('find.replaceAll')?.enabled === true;

  const applyHostSearchResult = (
    result: unknown,
    fallbackCanReplace = false,
    fallbackCanReplaceAll = fallbackCanReplace,
  ): void => {
    const snapshot = normalizeHostSearchResult(result, fallbackCanReplace, fallbackCanReplaceAll);
    if (!snapshot) {
      setSearchState({ total: 0, activeIndex: -1, canReplace: false, canReplaceAll: false, reason: undefined });
      return;
    }
    setSearchState({
      ...(snapshot.query !== undefined ? { query: snapshot.query } : {}),
      total: snapshot.total,
      activeIndex: snapshot.activeIndex,
      canReplace: snapshot.canReplace,
      canReplaceAll: snapshot.canReplaceAll,
      ...(snapshot.includeDeletedText !== undefined ? { includeDeletedText: snapshot.includeDeletedText } : {}),
      ...(snapshot.regex !== undefined ? { regex: snapshot.regex } : {}),
      reason: snapshot.invalidPattern ? SUPERDOC_UI_REASONS.searchInvalidPattern : undefined,
    });
  };
  const applyEditCommandSearchResult = (result: unknown): void =>
    applyHostSearchResult(result, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
  const markSearchUnavailable = (): void => {
    setSearchState({ available: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
  };

  const syncSearchStateFromHost = (): SearchSnapshot => {
    const host = getHostSearch();
    if (host && typeof host.getState !== 'function') {
      searchState = {
        ...searchState,
        available: searchIsAvailable(),
        reason: searchIsAvailable() ? undefined : SUPERDOC_UI_REASONS.searchUnavailable,
      };
      return searchState;
    }
    if (!host) {
      const editSearch = getEditCommandSearch();
      if (editSearch && typeof editSearch.getState === 'function') {
        const editSnapshot = normalizeHostSearchResult(
          safeCall<unknown>(() => hostMethod(editSearch, 'getState')?.(), null),
          readEditCommandCanReplace(),
          readEditCommandCanReplaceAll(),
        );
        if (pendingFallbackGeneration === searchRequestGeneration) return searchState;
        if (editSnapshot) {
          searchState = {
            ...searchState,
            ...(editSnapshot.query !== undefined ? { query: editSnapshot.query } : {}),
            total: editSnapshot.total,
            activeIndex: editSnapshot.activeIndex,
            canReplace: editSnapshot.canReplace,
            canReplaceAll: editSnapshot.canReplaceAll,
            available: true,
            reason: editSnapshot.invalidPattern ? SUPERDOC_UI_REASONS.searchInvalidPattern : undefined,
            open: searchState.open || Boolean(editSnapshot.query),
          };
          return searchState;
        }
      }
      searchState = {
        ...SEARCH_UNAVAILABLE_SLICE,
        query: searchState.query,
        caseSensitive: searchState.caseSensitive,
        includeTrackedDeletions: searchState.includeTrackedDeletions,
        includeDeletedText: searchState.includeDeletedText,
      };
      return searchState;
    }
    const snapshot = normalizeHostSearchResult(safeCall<unknown>(() => hostMethod(host, 'getState')?.(), null));
    if (!snapshot) return searchState;
    searchState = {
      ...searchState,
      ...(snapshot.query !== undefined ? { query: snapshot.query } : {}),
      total: snapshot.total,
      activeIndex: snapshot.activeIndex,
      canReplace: snapshot.canReplace,
      canReplaceAll: snapshot.canReplaceAll,
      ...(snapshot.includeDeletedText !== undefined ? { includeDeletedText: snapshot.includeDeletedText } : {}),
      ...(snapshot.includeDeletedText !== undefined ? { includeTrackedDeletions: snapshot.includeDeletedText } : {}),
      ...(snapshot.regex !== undefined ? { regex: snapshot.regex } : {}),
      available: true,
      reason: snapshot.invalidPattern ? SUPERDOC_UI_REASONS.searchInvalidPattern : undefined,
      open: searchState.open || Boolean(snapshot.query),
    };
    return searchState;
  };

  const resetForDocumentChange = (): void => {
    completedFallbackSearch = null;
    searchRequestGeneration += 1;
    pendingFallbackGeneration = null;
    shellFallbackOutstanding = false;
    cancelRefreshShellSearch();
    releaseSearchSession();
    const available = searchIsAvailable();
    searchState = {
      ...SEARCH_UNAVAILABLE_SLICE,
      available,
      reason: available ? undefined : SUPERDOC_UI_REASONS.searchUnavailable,
    };
    emitSearch();
  };
  deps.onDocumentReset(resetForDocumentChange);

  const republishReplaceCapabilityOnModeChange = (): void => {
    if (pendingFallbackGeneration === searchRequestGeneration) return;
    const before = searchState;
    const after = syncSearchStateFromHost();
    if (
      after.canReplace !== before.canReplace ||
      after.canReplaceAll !== before.canReplaceAll ||
      after.available !== before.available ||
      after.reason !== before.reason
    ) {
      emitSearch();
    }
  };
  deps.onDocumentModeChange(republishReplaceCapabilityOnModeChange);

  const settleHostSearchReplacement = (result: unknown): WorkflowActionResult | Promise<WorkflowActionResult> => {
    const generationBeforeEmit = searchRequestGeneration;
    syncSearchStateFromHost();
    emitSearch();
    if (!isPromiseLike(result)) return mapHostReplaceResult(result);
    return Promise.resolve(result).then(
      (resolved) => {
        if (generationBeforeEmit === searchRequestGeneration) {
          syncSearchStateFromHost();
          emitSearch();
        }
        return mapHostReplaceResult(resolved);
      },
      () => {
        if (generationBeforeEmit === searchRequestGeneration) markSearchUnavailable();
        return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
      },
    );
  };

  const settleEditCommandReplacement = (result: unknown): WorkflowActionResult | Promise<WorkflowActionResult> => {
    if (!isPromiseLike(result)) {
      syncSearchStateFromHost();
      emitSearch();
      return mapHostReplaceResult(result);
    }
    const generationBeforeEmit = searchRequestGeneration;
    syncSearchStateFromHost();
    emitSearch();
    const isCurrent = () => generationBeforeEmit === searchRequestGeneration;
    return Promise.resolve(result).then(
      (resolved) => {
        if (isCurrent()) {
          applyEditCommandSearchResult(resolved);
          syncSearchStateFromHost();
          emitSearch();
        }
        return mapHostReplaceResult(resolved);
      },
      () => {
        if (isCurrent()) markSearchUnavailable();
        return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
      },
    );
  };

  const navigate = (direction: 'next' | 'previous'): WorkflowActionResult => {
    const host = getHostSearch();
    if (!host || typeof host[direction] !== 'function') {
      const editSearch = getEditCommandSearch();
      if (!editSearch || typeof editSearch[direction] !== 'function' || typeof editSearch.getState !== 'function') {
        return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
      }
      if (searchState.total === 0) return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      const result = safeCall<unknown>(() => hostMethod(editSearch, direction)?.(), null);
      if (isPromiseLike(result)) {
        const sessionGeneration = searchRequestGeneration;
        void Promise.resolve(result)
          .then((resolved) => {
            if (sessionGeneration !== searchRequestGeneration) return;
            applyEditCommandSearchResult(resolved);
          })
          .catch(() => {
            if (sessionGeneration !== searchRequestGeneration) return;
            markSearchUnavailable();
          });
      } else {
        applyEditCommandSearchResult(result);
      }
      applyEditCommandSearchResult(safeCall<unknown>(() => hostMethod(editSearch, 'getState')?.(), null));
      return { ok: true };
    }
    if (searchState.total === 0) return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
    applyHostSearchResult(safeCall<unknown>(() => hostMethod(host, direction)?.(), null));
    return { ok: true };
  };

  const searchSnap = deps.snapshotHandle({
    get: () => syncSearchStateFromHost(),
    subscribe: (listener) => {
      searchListeners.add(listener);
      return () => searchListeners.delete(listener);
    },
  });

  const handle: SearchController = {
    get: searchSnap.get,
    getSnapshot: searchSnap.getSnapshot,
    subscribe: searchSnap.subscribe,
    observe: searchSnap.observe,
    open: (): WorkflowActionResult => {
      if (!searchIsAvailable()) {
        setSearchState({ available: false, open: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
        return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
      }
      setSearchState({ available: true, open: true, reason: undefined });
      return { ok: true };
    },
    close: (): void => {
      completedFallbackSearch = null;
      searchRequestGeneration += 1;
      cancelRefreshShellSearch();
      if (releaseActiveSearchSession) {
        releaseSearchSession();
      } else {
        const host = getHostSearch();
        if (host && typeof host.clear === 'function') {
          safeCall<unknown>(() => hostMethod(host, 'clear')?.(), null);
        } else {
          const editSearch = getEditCommandSearch();
          if (editSearch && typeof editSearch.query === 'function') {
            safeCall<unknown>(() => hostMethod(editSearch, 'query')?.({ query: '' }), null);
          }
        }
      }
      searchState = { ...SEARCH_UNAVAILABLE_SLICE, available: searchIsAvailable(), reason: undefined };
      if (!searchState.available) searchState.reason = SUPERDOC_UI_REASONS.searchUnavailable;
      emitSearch();
    },
    find: (query: string, options?: SearchQueryOptions): SearchSnapshot => {
      const host = getHostSearch();
      const caseSensitive = Boolean(options?.caseSensitive);
      const includeDeletedText = (options?.includeTrackedDeletions ?? options?.includeDeletedText) === true;
      const regex = options?.regex === true;
      if (
        (!host || typeof host.setSession !== 'function') &&
        completedFallbackSearch !== null &&
        completedFallbackSearch === getEditCommandSearch() &&
        pendingFallbackGeneration !== searchRequestGeneration &&
        searchRefreshTimer === null &&
        searchState.open &&
        searchState.available &&
        !searchState.reason &&
        searchState.query === query &&
        searchState.caseSensitive === caseSensitive &&
        searchState.includeDeletedText === includeDeletedText &&
        searchState.regex === regex
      ) {
        syncSearchStateFromHost();
        emitSearch();
        return searchState;
      }
      completedFallbackSearch = null;
      if (searchRefreshTimer !== null) {
        clearTimeout(searchRefreshTimer);
        searchRefreshTimer = null;
      }
      const generation = ++searchRequestGeneration;
      cancelRefreshShellSearch();
      cancelOutstandingShellFallback();
      if (!host || typeof host.setSession !== 'function') {
        const editSearch = getEditCommandSearch();
        if (editSearch && typeof editSearch.query === 'function' && typeof editSearch.getState === 'function') {
          pendingFallbackGeneration = generation;
          setSearchState({
            query,
            caseSensitive,
            includeDeletedText,
            regex,
            total: 0,
            activeIndex: -1,
            canReplace: false,
            canReplaceAll: false,
            available: true,
            open: true,
            reason: undefined,
          });
          releaseActiveSearchSession = () => {
            hostMethod(editSearch, 'query')?.({ query: '' });
          };
          const result = safeCall<unknown>(
            () => hostMethod(editSearch, 'query')?.({ query, caseSensitive, includeDeletedText, regex }),
            null,
          );
          if (isPromiseLike(result)) {
            shellFallbackOutstanding = true;
            void Promise.resolve(result).then(
              (resolved) => {
                if (generation !== searchRequestGeneration) return;
                shellFallbackOutstanding = false;
                pendingFallbackGeneration = null;
                completedFallbackSearch = editSearch;
                applyEditCommandSearchResult(resolved);
              },
              () => {
                if (generation !== searchRequestGeneration) return;
                shellFallbackOutstanding = false;
                markSearchUnavailable();
              },
            );
            return searchState;
          }
          pendingFallbackGeneration = null;
          completedFallbackSearch = editSearch;
          applyEditCommandSearchResult(result);
          applyEditCommandSearchResult(safeCall<unknown>(() => hostMethod(editSearch, 'getState')?.(), null));
          return searchState;
        }
        return setSearchState({
          query,
          total: 0,
          activeIndex: -1,
          available: false,
          caseSensitive,
          includeDeletedText,
          regex,
          reason: SUPERDOC_UI_REASONS.searchUnavailable,
        });
      }
      setSearchState({
        query,
        caseSensitive,
        includeDeletedText,
        regex,
        available: true,
        open: true,
        reason: undefined,
      });
      releaseActiveSearchSession = () => {
        hostMethod(host, 'clear')?.();
      };
      const result = safeCall<unknown>(
        () =>
          hostMethod(host, 'setSession')?.(query, {
            caseSensitive,
            includeDeletedText,
            ...(regex ? { regex: true } : {}),
            highlight: true,
          }),
        null,
      );
      applyHostSearchResult(result);
      if (
        query.length > 0 &&
        searchState.total === 0 &&
        searchState.reason !== SUPERDOC_UI_REASONS.searchInvalidPattern
      ) {
        const editSearch = getEditCommandSearch();
        if (editSearch && typeof editSearch.query === 'function' && typeof editSearch.getState === 'function') {
          const releaseHostSession = releaseActiveSearchSession;
          releaseActiveSearchSession = () => {
            releaseHostSession?.();
            hostMethod(editSearch, 'query')?.({ query: '' });
          };
          const commandResult = safeCall<unknown>(
            () => hostMethod(editSearch, 'query')?.({ query, caseSensitive, includeDeletedText, regex }),
            null,
          );
          if (isPromiseLike(commandResult)) {
            shellFallbackOutstanding = true;
            void Promise.resolve(commandResult).then(
              (resolved) => {
                if (generation !== searchRequestGeneration) return;
                shellFallbackOutstanding = false;
                applyEditCommandSearchResult(resolved);
              },
              () => {
                if (generation !== searchRequestGeneration) return;
                shellFallbackOutstanding = false;
                markSearchUnavailable();
              },
            );
          } else {
            applyEditCommandSearchResult(commandResult);
          }
          applyEditCommandSearchResult(safeCall<unknown>(() => hostMethod(editSearch, 'getState')?.(), null));
        }
      }
      return searchState;
    },
    search: (query: string, options?: SearchQueryOptions): SearchSnapshot => handle.find(query, options),
    next: (): WorkflowActionResult => navigate('next'),
    previous: (): WorkflowActionResult => navigate('previous'),
    clear: (): void => {
      completedFallbackSearch = null;
      searchRequestGeneration += 1;
      cancelRefreshShellSearch();
      cancelOutstandingShellFallback();
      const host = getHostSearch();
      if (host && typeof host.clear === 'function') safeCall<unknown>(() => hostMethod(host, 'clear')?.(), null);
      if (!host || typeof host.clear !== 'function') {
        const editSearch = getEditCommandSearch();
        if (editSearch && typeof editSearch.query === 'function') {
          safeCall<unknown>(() => hostMethod(editSearch, 'query')?.({ query: '' }), null);
        }
      }
      setSearchState({
        query: '',
        total: 0,
        activeIndex: -1,
        canReplace: false,
        canReplaceAll: false,
        reason: undefined,
      });
    },
    replace: (replacement: string): WorkflowActionResult | Promise<WorkflowActionResult> => {
      const host = getHostSearch();
      if (!host) {
        const editSearch = getEditCommandSearch();
        if (!editSearch || typeof editSearch.replace !== 'function' || typeof editSearch.getState !== 'function') {
          return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
        }
        if (!readEditCommandCanReplace()) return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
        const result = safeCall<unknown>(
          () => hostMethod(editSearch, 'replace')?.({ replacement: replacementText(replacement) }),
          null,
        );
        return settleEditCommandReplacement(result);
      }
      if (typeof host.replaceCurrent !== 'function') {
        return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
      const result = safeCall<unknown>(() => hostMethod(host, 'replaceCurrent')?.(replacementText(replacement)), null);
      return settleHostSearchReplacement(result);
    },
    replaceAll: (replacement: string): WorkflowActionResult | Promise<WorkflowActionResult> => {
      const host = getHostSearch();
      if (!host) {
        const editSearch = getEditCommandSearch();
        if (!editSearch || typeof editSearch.replaceAll !== 'function' || typeof editSearch.getState !== 'function') {
          return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
        }
        if (!readEditCommandCanReplaceAll()) {
          return {
            ok: false,
            reason:
              deps.editCommandState('find.replaceAll')?.reason === 'search-truncated'
                ? SUPERDOC_UI_REASONS.searchTruncated
                : SUPERDOC_UI_REASONS.operationUnavailable,
          };
        }
        const result = safeCall<unknown>(
          () => hostMethod(editSearch, 'replaceAll')?.({ replacement: replacementText(replacement) }),
          null,
        );
        return settleEditCommandReplacement(result);
      }
      if (typeof host.replaceAll !== 'function') {
        return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
      const result = safeCall<unknown>(() => hostMethod(host, 'replaceAll')?.(replacementText(replacement)), null);
      return settleHostSearchReplacement(result);
    },
  };

  const refreshOpenSession = (scheduledGeneration: number): void => {
    searchRefreshTimer = null;
    if (deps.isDisposed() || scheduledGeneration !== searchRequestGeneration || !searchState.open || !searchState.query)
      return;
    const input = {
      query: searchState.query,
      caseSensitive: searchState.caseSensitive,
      includeDeletedText: searchState.includeDeletedText,
      regex: searchState.regex,
    };
    const editSearch = getEditCommandSearch();
    const host = getHostSearch();
    if (typeof editSearch?.refresh !== 'function' && typeof host?.refresh !== 'function') return;
    const generation = ++searchRequestGeneration;
    cancelOutstandingShellFallback();
    if (typeof editSearch?.refresh === 'function' && typeof editSearch.query === 'function') {
      const capturedSearch = editSearch;
      releaseRefreshShellSearch = () => {
        hostMethod(capturedSearch, 'query')?.({ query: '' });
      };
    }
    const result =
      typeof editSearch?.refresh === 'function'
        ? safeCall<unknown>(() => hostMethod(editSearch, 'refresh')?.(input), null)
        : safeCall<unknown>(() => hostMethod(host, 'refresh')?.(), null);
    if (isPromiseLike(result)) {
      pendingFallbackGeneration = generation;
      setSearchState({ canReplace: false, canReplaceAll: false });
      void Promise.resolve(result).then(
        (resolved) => {
          if (generation !== searchRequestGeneration || deps.isDisposed()) return;
          releaseRefreshShellSearch = null;
          pendingFallbackGeneration = null;
          completedFallbackSearch = editSearch;
          applyEditCommandSearchResult(resolved);
        },
        () => {
          if (generation !== searchRequestGeneration || deps.isDisposed()) return;
          releaseRefreshShellSearch = null;
          markSearchUnavailable();
        },
      );
    } else if (result !== null) {
      releaseRefreshShellSearch = null;
      completedFallbackSearch = editSearch;
      applyHostSearchResult(result);
    }
  };

  const scheduleRefresh = (): void => {
    completedFallbackSearch = null;
    if (searchRefreshTimer !== null) clearTimeout(searchRefreshTimer);
    if (!searchState.open || !searchState.query) return;
    const scheduledGeneration = searchRequestGeneration;
    searchRefreshTimer = setTimeout(() => refreshOpenSession(scheduledGeneration), SEARCH_REFRESH_DELAY_MS);
  };

  const stopRefresh = (): void => {
    completedFallbackSearch = null;
    if (searchRefreshTimer !== null) clearTimeout(searchRefreshTimer);
    searchRefreshTimer = null;
    cancelRefreshShellSearch();
  };

  return {
    handle,
    scheduleRefresh,
    stopRefresh,
    clearListeners: () => searchListeners.clear(),
    invalidateInFlightRequests: () => {
      searchRequestGeneration += 1;
    },
  };
}
