// @ts-check
import { ref, computed, markRaw, watch } from 'vue';
import { createReplaceContinuation } from './replace-continuation.js';

/** @typedef {import('../core/types').FindReplaceConfig} FindReplaceConfig */
/** @typedef {import('../core/types').ResolvedFindReplaceTexts} ResolvedFindReplaceTexts */
/** @typedef {import('../core/types').FindReplaceHandle} FindReplaceHandle */
/** @typedef {import('../core/types').FindReplaceContext} FindReplaceContext */
/** @typedef {import('../core/types').FindReplaceResolution} FindReplaceResolution */

/** @type {ResolvedFindReplaceTexts} */
const DEFAULT_TEXTS = {
  findPlaceholder: 'Find',
  findAriaLabel: 'Find text',
  replacePlaceholder: 'Replace',
  replaceAriaLabel: 'Replace text',
  noResultsLabel: 'No results',
  previousMatchLabel: 'Previous match (Shift+Enter)',
  previousMatchAriaLabel: 'Previous match',
  nextMatchLabel: 'Next match (Enter)',
  nextMatchAriaLabel: 'Next match',
  closeLabel: 'Close (Escape)',
  closeAriaLabel: 'Close find and replace',
  replaceLabel: 'Replace',
  replaceAllLabel: 'All',
  toggleReplaceLabel: 'Toggle replace',
  toggleReplaceAriaLabel: 'Toggle replace',
  matchCaseLabel: 'Aa',
  matchCaseAriaLabel: 'Match case',
  regexLabel: '.*',
  regexAriaLabel: 'Use regular expression',
  invalidPatternLabel: 'Invalid pattern',
  ignoreDiacriticsLabel: '\u00e4\u2261a',
  ignoreDiacriticsAriaLabel: 'Ignore diacritics',
};

/**
 * @typedef {Object} SearchResult The shape of `setSearchSession`,
 *   `nextSearchMatch`, `previousSearchMatch`, `replaceSearchMatch` returns.
 *   The Search extension is renderer-owned; this composable only consumes
 *   the two fields below.
 * @property {{ length: number }[]} matches
 * @property {number} activeMatchIndex
 */

/**
 * @typedef {Object} SearchCommands The search command subset consumed here.
 * @property {() => void} clearSearchSession
 * @property {(query: string, options: { caseSensitive: boolean, ignoreDiacritics: boolean, highlight: boolean, searchModel: 'raw' | 'visible' }) => SearchResult} setSearchSession
 * @property {() => SearchResult} nextSearchMatch
 * @property {() => SearchResult} previousSearchMatch
 * @property {(replacement: string) => SearchResult} replaceSearchMatch
 * @property {(replacement: string) => void} replaceAllSearchMatches
 */

/**
 * @typedef {import('../core/types/index.js').Editor & {
 *   commands: SearchCommands,
 *   extensionStorage?: Record<string, unknown>,
 *   storage?: Record<string, unknown>
 * }} SearchEditor
 */

/**
 * @typedef {Object} SearchStorage The Search extension's storage shape.
 *   The Search extension is renderer-owned; this composable only
 *   needs the fields it reads to detect a live search session and resync
 *   from external mutations.
 * @property {unknown} [searchIndex]
 * @property {unknown} [searchResults]
 * @property {number} [activeMatchIndex]
 * @property {{ length: number }[]} [matches]
 */

/**
 * Resolve the Search extension storage from the editor.
 * The storage is keyed by extension name in editor.extensionStorage;
 * we find it by looking for the object with our known storage shape.
 * @param {SearchEditor | null | undefined} editor
 * @returns {SearchStorage | null}
 */
function getSearchStorage(editor) {
  if (!editor) return null;

  // Try direct access by common name first. The Search storage shape is local
  // to the renderer, so cast to the subset this composable consumes.
  const extensionStorage = /** @type {Record<string, unknown> | undefined} */ (editor.extensionStorage);
  const storage = /** @type {Record<string, unknown> | undefined} */ (editor.storage);
  const byName = /** @type {SearchStorage | undefined} */ (extensionStorage?.Search ?? storage?.Search);
  if (byName?.searchIndex || byName?.searchResults) return byName;

  // Fall back to scanning extensionStorage for the Search extension's storage
  const store = editor.extensionStorage ?? editor.storage;
  if (store) {
    for (const key of Object.keys(store)) {
      const val = /** @type {Record<string, unknown>} */ (store)[key];
      if (val && typeof val === 'object' && 'searchIndex' in val && 'searchResults' in val) {
        return /** @type {SearchStorage} */ (val);
      }
    }
  }
  return null;
}

/**
 * Composable that manages a find/replace floating surface.
 *
 * Owns all search state (query, toggles, match count, active index) and the
 * resolution chain for custom/external/built-in rendering. The component
 * receives a FindReplaceHandle with reactive state and actions.
 *
 * @param {Object} options
 * @param {() => import('../core/surface-manager.js').SurfaceManager | null} options.getSurfaceManager
 * @param {() => SearchEditor | null} options.getActiveEditor
 * @param {import('vue').Ref} [options.activeEditorRef] - Reactive ref to the active editor (for watching switches)
 * @param {() => boolean | FindReplaceConfig | undefined} [options.getFindReplaceConfig] - Config getter
 * @param {() => { search?: any } | null | undefined} [options.getSuperDocUI] - Getter for the
 *   SuperDoc-owned UI controller (`superdoc.ui`). Its `.search` slice is the single V2
 *   find/replace session authority; the V2 driver never touches `editor.commands`.
 */
export function useFindReplace({
  getSurfaceManager,
  getActiveEditor,
  activeEditorRef,
  getFindReplaceConfig,
  getSuperDocUI,
}) {
  // ---- internal state -------------------------------------------------------

  /** @type {import('../core/surface-manager.js').SurfaceHandle | null} */
  let currentSurfaceHandle = null;
  /** @type {SearchEditor | null} */
  let currentEditor = null;
  /**
   * The V2 `ui.search` handle for the current session, or null when the active
   * editor is V1 (command-backed). Set at open() time based on the editor.
   * @type {any}
   */
  let currentV2Search = null;
  let destroyed = false;
  let opening = false; // sync guard against double-open across the await gap

  const isOpen = ref(false);

  /**
   * Ref to the find input element, set by the renderer via handle.registerFocusFn.
   * @type {(() => void) | null}
   */
  let focusFindInputFn = null;

  // ---- reactive state (owned by composable, consumed by renderers) ----------

  const findQuery = ref('');
  const replaceText = ref('');
  const caseSensitive = ref(false);
  const ignoreDiacritics = ref(false);
  // Regex search is a V2 (ui.search) capability; the V1 driver hides the
  // toggle (see regexSupported below).
  const regex = ref(false);
  const showReplace = ref(false);
  const matchCount = ref(0);
  const activeMatchIndex = ref(-1);
  // Whether replace can mutate right now. V1 leaves this true (the static
  // `replaceEnabled` config governs V1); the V2 driver drives it from the host
  // search session so viewing/read-only mode disables the replace controls.
  const canReplaceState = ref(true);
  // Whether replace-all can run right now. The V2 host reports it separately:
  // a truncated session still replaces the active match but refuses to replace
  // every match it could not enumerate. V1 leaves this true.
  const canReplaceAllState = ref(true);
  // Re-entrancy guard so a repeated click cannot issue overlapping mutations.
  const replacePending = ref(false);
  // V1 supports ignore-diacritics search; V2 (Document API query) does not, so
  // the V2 driver hides that toggle instead of shipping a no-op control.
  const ignoreDiacriticsSupported = ref(true);
  // Regex search ships on the V2 driver only; V1 hides the toggle.
  const regexSupported = ref(false);
  // Inline error label when the current regex pattern is invalid/unsafe.
  /** @type {import('vue').Ref<string | null>} */
  const searchError = ref(null);

  /** Current resolved texts — updated on each open(). */
  let currentTexts = DEFAULT_TEXTS;

  const matchLabel = computed(() => {
    if (!findQuery.value) return '';
    if (matchCount.value === 0) return currentTexts.noResultsLabel;
    return `${activeMatchIndex.value + 1} of ${matchCount.value}`;
  });

  const hasMatches = computed(() => matchCount.value > 0);

  // Whether the replace controls should be enabled: there are matches, replace
  // is not in flight, and the active session allows mutation (V2 read-only mode
  // sets `canReplaceState` false; V1 keeps it true).
  const canReplaceComputed = computed(() => hasMatches.value && !replacePending.value && canReplaceState.value);
  // Replace all additionally needs the session to enumerate every match.
  const canReplaceAllComputed = computed(() => canReplaceComputed.value && canReplaceAllState.value);

  // ---- timers ---------------------------------------------------------------

  /** @type {ReturnType<typeof setTimeout> | null} */
  let debounceTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let syncInterval = null;

  // ---- driver detection -----------------------------------------------------

  /**
   * A V1 editor exposes the command-backed search session API. The V2 active
   * editor facade carries no `commands`, so absence of `setSearchSession`
   * selects the V2 (`ui.search`) driver.
   * @param {any} editor
   */
  function isV1Editor(editor) {
    return typeof editor?.commands?.setSearchSession === 'function';
  }

  /**
   * Resolve the V2 `ui.search` handle when available. Never throws.
   * @returns {any}
   */
  function resolveV2Search() {
    try {
      const ui = typeof getSuperDocUI === 'function' ? getSuperDocUI() : null;
      const search = ui?.search;
      return search && (typeof search.find === 'function' || typeof search.search === 'function') ? search : null;
    } catch {
      return null;
    }
  }

  /**
   * Sync the reactive match state from the current V2 host search snapshot.
   * @param {any} slice
   */
  function applyV2Slice(slice) {
    if (!slice) return;
    matchCount.value = typeof slice.total === 'number' ? slice.total : 0;
    activeMatchIndex.value = typeof slice.activeIndex === 'number' ? slice.activeIndex : -1;
    canReplaceState.value = slice.canReplace === true;
    // Older controllers publish only `canReplace`; treat that as covering both.
    canReplaceAllState.value =
      typeof slice.canReplaceAll === 'boolean' ? slice.canReplaceAll : slice.canReplace === true;
    searchError.value = slice.reason === 'search-invalid-pattern' ? currentTexts.invalidPatternLabel : null;
  }

  // ---- search logic ---------------------------------------------------------

  function runSearch() {
    if (currentV2Search) {
      runV2Search();
      return;
    }
    if (!currentEditor) return;
    if (!findQuery.value) {
      try {
        currentEditor.commands.clearSearchSession();
      } catch {
        /* destroyed */
      }
      matchCount.value = 0;
      activeMatchIndex.value = -1;
      return;
    }

    try {
      const result = /** @type {SearchResult} */ (
        currentEditor.commands.setSearchSession(findQuery.value, {
          caseSensitive: caseSensitive.value,
          ignoreDiacritics: ignoreDiacritics.value,
          highlight: true,
          searchModel: resolveConfig().includeDeletedText ? 'raw' : 'visible',
        })
      );
      matchCount.value = result.matches.length;
      activeMatchIndex.value = result.activeMatchIndex;
    } catch {
      /* editor may be destroyed */
    }
  }

  function runV2Search() {
    const search = currentV2Search;
    if (!search) return;
    if (!findQuery.value) {
      try {
        search.clear();
      } catch {
        /* host gone */
      }
      matchCount.value = 0;
      activeMatchIndex.value = -1;
      searchError.value = null;
      return;
    }
    try {
      const commonOptions = {
        caseSensitive: caseSensitive.value,
        regex: regex.value,
      };
      const includeTrackedDeletions = resolveConfig().includeDeletedText === true;
      const slice =
        typeof search.find === 'function'
          ? search.find(findQuery.value, { ...commonOptions, includeTrackedDeletions })
          : search.search(findQuery.value, { ...commonOptions, includeDeletedText: includeTrackedDeletions });
      applyV2Slice(slice);
    } catch {
      /* host may be gone */
    }
  }

  function debouncedSearch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 150);
  }

  // Watchers run only when the surface is open (refs are reset on close).
  // They fire because open() calls resetState() which changes the ref values,
  // then user input changes them further.
  watch(findQuery, () => {
    if (isOpen.value) debouncedSearch();
  });
  watch(caseSensitive, () => {
    if (isOpen.value) runSearch();
  });
  watch(ignoreDiacritics, () => {
    if (isOpen.value) runSearch();
  });
  watch(regex, () => {
    if (isOpen.value) runSearch();
  });

  // ---- actions --------------------------------------------------------------

  let currentReplaceEnabled = true;

  function goNext() {
    if (!hasMatches.value) return;
    if (currentV2Search) {
      try {
        currentV2Search.next();
        applyV2Slice(currentV2Search.getSnapshot());
      } catch {
        /* host gone */
      }
      return;
    }
    if (!currentEditor) return;
    try {
      const result = /** @type {SearchResult} */ (currentEditor.commands.nextSearchMatch());
      activeMatchIndex.value = result.activeMatchIndex;
    } catch {
      /* destroyed */
    }
  }

  function goPrev() {
    if (!hasMatches.value) return;
    if (currentV2Search) {
      try {
        currentV2Search.previous();
        applyV2Slice(currentV2Search.getSnapshot());
      } catch {
        /* host gone */
      }
      return;
    }
    if (!currentEditor) return;
    try {
      const result = /** @type {SearchResult} */ (currentEditor.commands.previousSearchMatch());
      activeMatchIndex.value = result.activeMatchIndex;
    } catch {
      /* destroyed */
    }
  }

  function replaceCurrent() {
    if (!currentReplaceEnabled) return;
    if (replacePending.value) return;
    if (!hasMatches.value) return;
    if (currentV2Search) {
      if (!canReplaceState.value) return;
      const search = currentV2Search;
      replacePending.value = true;
      const finish = createReplaceContinuation(search, {
        getCurrentSession: () => currentV2Search,
        applySlice: applyV2Slice,
        onSettled: () => {
          replacePending.value = false;
        },
      });
      let result = null;
      try {
        result = search.replace(replaceText.value);
      } catch {
        /* host gone */
      }
      // Worker-backed replace resolves asynchronously. Hold the pending flag
      // (which disables the replace controls) until the mutation settles so a
      // second click cannot start a concurrent replace.
      if (result && typeof result.then === 'function') {
        void Promise.resolve(result).then(finish, finish);
      } else {
        finish();
      }
      return;
    }
    if (!currentEditor) return;
    try {
      const result = /** @type {SearchResult} */ (currentEditor.commands.replaceSearchMatch(replaceText.value));
      matchCount.value = result.matches.length;
      activeMatchIndex.value = result.activeMatchIndex;
    } catch {
      /* destroyed */
    }
  }

  function replaceAll() {
    if (!currentReplaceEnabled) return;
    if (replacePending.value) return;
    if (!hasMatches.value) return;
    if (currentV2Search) {
      if (!canReplaceState.value || !canReplaceAllState.value) return;
      const search = currentV2Search;
      replacePending.value = true;
      const finish = createReplaceContinuation(search, {
        getCurrentSession: () => currentV2Search,
        applySlice: applyV2Slice,
        onSettled: () => {
          replacePending.value = false;
        },
      });
      let result = null;
      try {
        result = search.replaceAll(replaceText.value);
      } catch {
        /* host gone */
      }
      // Worker-backed replace-all resolves asynchronously. Hold the pending
      // flag (which disables the replace controls) until the mutations settle
      // so a second click cannot start a concurrent replace-all.
      if (result && typeof result.then === 'function') {
        void Promise.resolve(result).then(finish, finish);
      } else {
        finish();
      }
      return;
    }
    if (!currentEditor) return;
    try {
      currentEditor.commands.replaceAllSearchMatches(replaceText.value);
      matchCount.value = 0;
      activeMatchIndex.value = -1;
    } catch {
      /* destroyed */
    }
  }

  // ---- polling --------------------------------------------------------------

  function syncFromEditorStorage() {
    if (currentV2Search) {
      try {
        applyV2Slice(currentV2Search.getSnapshot());
      } catch {
        /* host gone */
      }
      return;
    }
    const storage = getSearchStorage(currentEditor);
    if (!storage) return;

    const results = storage.searchResults;
    const count = Array.isArray(results) ? results.length : 0;
    const idx = storage.activeMatchIndex ?? -1;

    if (count !== matchCount.value) matchCount.value = count;
    if (idx !== activeMatchIndex.value) activeMatchIndex.value = idx;
  }

  function startPolling() {
    stopPolling();
    syncInterval = setInterval(syncFromEditorStorage, 200);
  }

  function stopPolling() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = null;
  }

  // ---- state reset ----------------------------------------------------------

  function resetState() {
    findQuery.value = '';
    replaceText.value = '';
    caseSensitive.value = false;
    ignoreDiacritics.value = false;
    regex.value = false;
    searchError.value = null;
    showReplace.value = false;
    matchCount.value = 0;
    activeMatchIndex.value = -1;
    canReplaceState.value = true;
    canReplaceAllState.value = true;
    replacePending.value = false;
  }

  // ---- config resolution ----------------------------------------------------

  /**
   * Normalise `getFindReplaceConfig()` into a full config with defaults.
   * Throws on invalid combinations (component + render).
   */
  function resolveConfig() {
    const raw = typeof getFindReplaceConfig === 'function' ? getFindReplaceConfig() : undefined;

    if (raw === false || raw == null) {
      return { enabled: false, texts: DEFAULT_TEXTS, replaceEnabled: true };
    }

    if (raw === true) {
      return { enabled: true, texts: DEFAULT_TEXTS, replaceEnabled: true };
    }

    const cfg = typeof raw === 'object' ? raw : {};

    if (cfg.component != null && typeof cfg.render === 'function') {
      throw new Error('Search configuration cannot provide both "component" and "render". Use one or the other.');
    }

    /** @type {ResolvedFindReplaceTexts} */
    const texts = {
      findPlaceholder: cfg.findPlaceholder ?? DEFAULT_TEXTS.findPlaceholder,
      findAriaLabel: cfg.findAriaLabel ?? DEFAULT_TEXTS.findAriaLabel,
      replacePlaceholder: cfg.replacePlaceholder ?? DEFAULT_TEXTS.replacePlaceholder,
      replaceAriaLabel: cfg.replaceAriaLabel ?? DEFAULT_TEXTS.replaceAriaLabel,
      noResultsLabel: cfg.noResultsLabel ?? DEFAULT_TEXTS.noResultsLabel,
      previousMatchLabel: cfg.previousMatchLabel ?? DEFAULT_TEXTS.previousMatchLabel,
      previousMatchAriaLabel: cfg.previousMatchAriaLabel ?? DEFAULT_TEXTS.previousMatchAriaLabel,
      nextMatchLabel: cfg.nextMatchLabel ?? DEFAULT_TEXTS.nextMatchLabel,
      nextMatchAriaLabel: cfg.nextMatchAriaLabel ?? DEFAULT_TEXTS.nextMatchAriaLabel,
      closeLabel: cfg.closeLabel ?? DEFAULT_TEXTS.closeLabel,
      closeAriaLabel: cfg.closeAriaLabel ?? DEFAULT_TEXTS.closeAriaLabel,
      replaceLabel: cfg.replaceLabel ?? DEFAULT_TEXTS.replaceLabel,
      replaceAllLabel: cfg.replaceAllLabel ?? DEFAULT_TEXTS.replaceAllLabel,
      toggleReplaceLabel: cfg.toggleReplaceLabel ?? DEFAULT_TEXTS.toggleReplaceLabel,
      toggleReplaceAriaLabel: cfg.toggleReplaceAriaLabel ?? DEFAULT_TEXTS.toggleReplaceAriaLabel,
      matchCaseLabel: cfg.matchCaseLabel ?? DEFAULT_TEXTS.matchCaseLabel,
      matchCaseAriaLabel: cfg.matchCaseAriaLabel ?? DEFAULT_TEXTS.matchCaseAriaLabel,
      regexLabel: cfg.regexLabel ?? DEFAULT_TEXTS.regexLabel,
      regexAriaLabel: cfg.regexAriaLabel ?? DEFAULT_TEXTS.regexAriaLabel,
      invalidPatternLabel: cfg.invalidPatternLabel ?? DEFAULT_TEXTS.invalidPatternLabel,
      ignoreDiacriticsLabel: cfg.ignoreDiacriticsLabel ?? DEFAULT_TEXTS.ignoreDiacriticsLabel,
      ignoreDiacriticsAriaLabel: cfg.ignoreDiacriticsAriaLabel ?? DEFAULT_TEXTS.ignoreDiacriticsAriaLabel,
    };

    return {
      enabled: true,
      texts,
      replaceEnabled: cfg.replaceEnabled ?? true,
      includeDeletedText: cfg.includeDeletedText ?? false,
      component: cfg.component,
      props: cfg.props,
      render: cfg.render,
      resolver: cfg.resolver,
      // Where the floating find bar is pinned. Integrators set this via
      // `modules.surfaces.findReplace.floating` to move it out of the way of the
      // document, e.g. `{ placement: 'bottom-right' }` or explicit insets
      // `{ top: 12, right: 24 }`. Merged over the default in `open()`.
      floating: cfg.floating && typeof cfg.floating === 'object' ? cfg.floating : undefined,
    };
  }

  /**
   * Walk the 3-tier resolution chain:
   * 1. Dedicated findReplace.resolver
   * 2. Direct findReplace.component / findReplace.render
   * 3. Built-in FindReplaceSurface
   *
   * @param {ReturnType<typeof resolveConfig>} config
   * @param {FindReplaceContext} resolverCtx
   * @returns {{ suppressed?: boolean, component?: unknown, props?: Record<string, unknown>, render?: Function, builtin?: boolean }}
   */
  function resolveRendering(config, resolverCtx) {
    // Tier 1: dedicated resolver
    if (typeof config.resolver === 'function') {
      const resolution = config.resolver(resolverCtx);

      if (resolution != null && resolution.type !== 'default') {
        if (resolution.type === 'none') return { suppressed: true };
        if (resolution.type === 'custom') return { component: resolution.component, props: resolution.props };
        if (resolution.type === 'external') return { render: resolution.render };
      }
      // null / undefined / { type: 'default' } → fall through
    }

    // Tier 2: direct component/render from config
    if (config.component != null) return { component: config.component, props: config.props };
    if (typeof config.render === 'function') return { render: config.render };

    // Tier 3: built-in
    return { builtin: true };
  }

  // ---- handle ---------------------------------------------------------------

  /**
   * Build a FindReplaceHandle from reactive state + actions + config.
   * @param {ReturnType<typeof resolveConfig>} config
   * @param {(reason?: unknown) => void} closeFn Late-wired close function
   * @returns {FindReplaceHandle}
   */
  function createHandle(config, closeFn) {
    return {
      // Reactive state
      findQuery,
      replaceText,
      caseSensitive,
      ignoreDiacritics,
      regex,
      showReplace,
      matchCount,
      activeMatchIndex,
      matchLabel,
      hasMatches,
      canReplace: canReplaceComputed,
      /**
       * `canReplace` plus the session enumerating every match. A truncated V2
       * session keeps Replace enabled and disables Replace all.
       */
      canReplaceAll: canReplaceAllComputed,
      /**
       * Runtime mutability of the active session (viewing/read-only mode sets
       * this false). Distinct from the static `replaceEnabled` config and from
       * `canReplace`, which also requires matches: surfaces hide replace
       * CONTROLS on this, and disable replace ACTIONS on `canReplace`.
       */
      replaceCanMutate: canReplaceState,
      replacePending,
      ignoreDiacriticsSupported,
      regexSupported,
      searchError,
      // Metadata
      replaceEnabled: config.replaceEnabled ?? true,
      texts: config.texts,
      // Actions
      goNext,
      goPrev,
      replaceCurrent,
      replaceAll,
      registerFocusFn: (fn) => {
        focusFindInputFn = fn;
      },
      close: (reason) => closeFn(reason),
    };
  }

  /**
   * Wrap a FindReplaceHandle for external (non-Vue) renderers.
   * Converts Vue refs to JavaScript getter/setter properties.
   * @param {FindReplaceHandle} handle
   */
  function wrapHandleForExternal(handle) {
    return {
      get findQuery() {
        return handle.findQuery.value;
      },
      set findQuery(v) {
        handle.findQuery.value = v;
      },
      get replaceText() {
        return handle.replaceText.value;
      },
      set replaceText(v) {
        handle.replaceText.value = v;
      },
      get caseSensitive() {
        return handle.caseSensitive.value;
      },
      set caseSensitive(v) {
        handle.caseSensitive.value = v;
      },
      get ignoreDiacritics() {
        return handle.ignoreDiacritics.value;
      },
      set ignoreDiacritics(v) {
        handle.ignoreDiacritics.value = v;
      },
      get regex() {
        return handle.regex.value;
      },
      set regex(v) {
        handle.regex.value = v;
      },
      get regexSupported() {
        return handle.regexSupported.value;
      },
      get searchError() {
        return handle.searchError.value;
      },
      get replaceCanMutate() {
        return handle.replaceCanMutate.value;
      },
      get showReplace() {
        return handle.showReplace.value;
      },
      set showReplace(v) {
        handle.showReplace.value = v;
      },
      get matchCount() {
        return handle.matchCount.value;
      },
      get activeMatchIndex() {
        return handle.activeMatchIndex.value;
      },
      get matchLabel() {
        return handle.matchLabel.value;
      },
      get hasMatches() {
        return handle.hasMatches.value;
      },
      get canReplace() {
        return handle.canReplace.value;
      },
      get canReplaceAll() {
        return handle.canReplaceAll ? handle.canReplaceAll.value : handle.canReplace.value;
      },
      get replacePending() {
        return handle.replacePending.value;
      },
      get ignoreDiacriticsSupported() {
        return handle.ignoreDiacriticsSupported.value;
      },
      replaceEnabled: handle.replaceEnabled,
      texts: handle.texts,
      goNext: handle.goNext,
      goPrev: handle.goPrev,
      replaceCurrent: handle.replaceCurrent,
      replaceAll: handle.replaceAll,
      registerFocusFn: handle.registerFocusFn,
      close: handle.close,
    };
  }

  // ---- public API -----------------------------------------------------------

  /**
   * Clear the search session on the given editor, swallowing errors
   * (the editor may already be destroyed).
   * @param {SearchEditor | null | undefined} editor
   */
  function clearEditorSession(editor) {
    if (!editor) return;
    if (typeof editor?.commands?.clearSearchSession === 'function') {
      try {
        editor.commands.clearSearchSession();
      } catch {
        /* destroyed */
      }
      return;
    }
    // V2: clear the host search session (query, matches, highlights) when this
    // is the active V2 editor.
    if (currentV2Search && editor === currentEditor) {
      try {
        currentV2Search.clear();
      } catch {
        /* host gone */
      }
    }
  }

  /**
   * Synchronous check: would open() produce a surface?
   * Used by the shortcut handler to decide whether to call preventDefault().
   * Never throws — a bad config or throwing resolver returns false so the
   * browser's native Cmd+F takes over instead of breaking keyboard handling.
   */
  function wouldOpen() {
    try {
      if (destroyed) return false;
      if (!getSurfaceManager()) return false;
      if (!getActiveEditor()) return false;

      // If already open, wouldOpen returns true (it will refocus)
      if (currentSurfaceHandle && isOpen.value) return true;

      const config = resolveConfig();
      if (!config.enabled) return false;

      const resolverCtx = { texts: config.texts, replaceEnabled: config.replaceEnabled ?? true };
      const resolution = resolveRendering(config, resolverCtx);
      if (resolution.suppressed) return false;

      // V2: only claim the shortcut when the host actually exposes a usable
      // search facade. Otherwise fall through so browser-native Cmd+F still
      // works (worker/pre-ready hosts, or builds without the search substrate).
      const editor = getActiveEditor();
      if (!isV1Editor(editor)) {
        const search = resolveV2Search();
        if (!search) return false;
        try {
          if (search.getSnapshot?.().available !== true) return false;
        } catch {
          return false;
        }
      }
      return true;
    } catch {
      // Bad config (component + render) or throwing resolver — fall back to
      // browser default so the shortcut handler doesn't swallow Cmd+F.
      return false;
    }
  }

  /**
   * Open the find/replace surface, or refocus it if already open.
   */
  async function open() {
    if (destroyed) return;

    const manager = getSurfaceManager();
    if (!manager) return;

    // If already open, refocus the find input and return
    if (currentSurfaceHandle && isOpen.value) {
      focusFindInputFn?.();
      return;
    }

    // Sync guard that covers the await gap
    if (opening) return;
    opening = true;

    try {
      const editor = getActiveEditor();
      if (!editor) {
        opening = false;
        return;
      }

      const config = resolveConfig();
      if (!config.enabled) {
        opening = false;
        return;
      }

      const resolverCtx = { texts: config.texts, replaceEnabled: config.replaceEnabled ?? true };
      const resolution = resolveRendering(config, resolverCtx);

      if (resolution.suppressed) {
        opening = false;
        return;
      }

      // Reset reactive state for a new session
      resetState();
      currentTexts = config.texts;
      currentReplaceEnabled = config.replaceEnabled ?? true;

      // Floating placement: default top-right, overridable via config so the
      // integrator can move the bar out of the document's way.
      const floatingOptions =
        /** @type {{ placement?: import('../core/types/index.js').SurfaceFloatingPlacement } & Record<string, unknown>} */ ({
          placement: 'top-right',
          autoFocus: true,
          // The one-row find layout (field + query toggles + nav) needs more
          // room than the 360px floating default before queries truncate.
          width: 420,
          ...config.floating,
        });

      // If there was a previous editor with an open search session, clear it
      if (currentEditor && currentEditor !== editor) {
        clearEditorSession(currentEditor);
      }
      currentEditor = editor;
      // Bind the driver: V1 command-backed editors use `editor.commands`; V2
      // routes through the host search session via `ui.search`.
      currentV2Search = isV1Editor(editor) ? null : resolveV2Search();
      ignoreDiacriticsSupported.value = !currentV2Search;
      regexSupported.value = Boolean(currentV2Search);
      // Seed session mutability from the live snapshot so read-only mode hides
      // the replace controls on open instead of after the first query/poll.
      if (currentV2Search) {
        try {
          applyV2Slice(currentV2Search.getSnapshot());
        } catch {
          /* host gone */
        }
      }
      focusFindInputFn = null;

      // Late-wired close — the handle is created before the surface opens
      /** @type {(reason?: unknown) => void} */
      let lateCloseFn = () => {};

      const handle = createHandle(config, (reason) => lateCloseFn(reason));

      let surfaceHandle;

      if (resolution.component) {
        // Custom Vue component (from resolver or direct config)
        surfaceHandle = manager.open({
          mode: 'floating',
          ariaLabel: config.texts.findAriaLabel,
          closeOnEscape: true,
          floating: floatingOptions,
          component: markRaw(resolution.component),
          props: { ...resolution.props, findReplace: handle },
        });
      } else if (resolution.render) {
        // External renderer (from resolver or direct config)
        const userRender = resolution.render;
        surfaceHandle = manager.open({
          mode: 'floating',
          ariaLabel: config.texts.findAriaLabel,
          closeOnEscape: true,
          floating: floatingOptions,
          render: (ctx) =>
            userRender({
              container: ctx.container,
              findReplace: wrapHandleForExternal(handle),
              resolve: ctx.resolve,
              close: ctx.close,
              surfaceId: ctx.surfaceId,
              mode: ctx.mode,
            }),
        });
      } else {
        // Built-in — lazy import. The `.vue` shim types the default export as
        // `unknown`; narrow to `object` for `markRaw()` since the Vue compiler
        // guarantees the SFC default export is a component definition object.
        /** @type {object | undefined} */
        let FindReplaceSurface;
        try {
          const mod = await import('../components/surfaces/FindReplaceSurface.vue');
          FindReplaceSurface = /** @type {object} */ (mod.default);
        } catch {
          opening = false;
          return;
        }

        // Re-check after the await — state may have changed while we were loading
        if (destroyed || (currentSurfaceHandle && isOpen.value)) {
          opening = false;
          return;
        }

        // Re-read the active editor in case it changed during the import
        const freshEditor = getActiveEditor() || editor;
        if (currentEditor !== freshEditor) {
          clearEditorSession(currentEditor);
          currentEditor = freshEditor;
          currentV2Search = isV1Editor(freshEditor) ? null : resolveV2Search();
          ignoreDiacriticsSupported.value = !currentV2Search;
        }

        surfaceHandle = manager.open({
          mode: 'floating',
          ariaLabel: config.texts.findAriaLabel,
          component: markRaw(FindReplaceSurface),
          closeOnEscape: true,
          floating: floatingOptions,
          props: { findReplace: handle },
        });
      }

      // Wire late close
      lateCloseFn = (reason) => surfaceHandle.close(reason ?? 'programmatic');
      currentSurfaceHandle = surfaceHandle;
      isOpen.value = true;
      opening = false;

      // Start polling editor storage for external changes
      startPolling();

      // Capture handle ID for stale-settle detection
      const handleId = surfaceHandle.id;

      surfaceHandle.result.then(() => {
        if (currentSurfaceHandle?.id === handleId) {
          stopPolling();
          clearEditorSession(currentEditor);
          currentSurfaceHandle = null;
          isOpen.value = false;
          focusFindInputFn = null;
        } else {
          // A newer open() already took over; just clean up our editor's
          // session if it's a different editor than the one now active.
          clearEditorSession(editor !== currentEditor ? editor : null);
        }
      });
    } catch (err) {
      // Ensure the sync guard is always released so a bad config or
      // throwing resolver doesn't permanently block future opens.
      opening = false;
      throw err;
    }
  }

  /**
   * Close the find/replace surface and clear search state.
   */
  function close() {
    if (currentSurfaceHandle) {
      currentSurfaceHandle.close('programmatic');
    }
  }

  // Watch for active editor changes — clear previous editor's search and close surface
  if (activeEditorRef) {
    watch(activeEditorRef, (newEditor, oldEditor) => {
      if (!isOpen.value || !currentSurfaceHandle) return;
      if (newEditor === oldEditor) return;

      clearEditorSession(oldEditor);
      close();
    });
  }

  /**
   * Tear down the composable. Call from onBeforeUnmount.
   */
  function destroy() {
    destroyed = true;
    stopPolling();
    close();
    currentEditor = null;
    currentV2Search = null;
    focusFindInputFn = null;
  }

  return {
    open,
    close,
    isOpen,
    wouldOpen,
    destroy,
  };
}
