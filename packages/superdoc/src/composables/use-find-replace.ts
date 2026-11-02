import { ref, computed, watch, type Ref } from 'vue';
import { markRawComponent } from '../helpers/mark-raw-component.js';
import { isThenable } from '../helpers/object-guards.js';
import { createReplaceContinuation } from './replace-continuation.js';
import type { SurfaceManager } from '../core/surface-manager.js';
import type {
  Editor,
  FindReplaceConfig,
  FindReplaceContext,
  FindReplaceHandle,
  ResolvedFindReplaceTexts,
  SearchFloatingConfig,
  SurfaceHandle,
} from '../core/types/index.js';
import type { SearchController, SearchSlice, SearchSnapshot } from '../public/ui/types.js';

type FindReplaceSearchQuery = (...args: Parameters<SearchController['find']>) => Partial<SearchSnapshot>;

export type FindReplaceSearch = Pick<SearchController, 'next' | 'previous' | 'clear' | 'replace' | 'replaceAll'> & {
  getSnapshot: () => Partial<SearchSnapshot>;
} & (
    | { find: FindReplaceSearchQuery; search?: FindReplaceSearchQuery }
    | { find?: undefined; search: FindReplaceSearchQuery }
  );

type FindReplaceRenderer = NonNullable<FindReplaceConfig['render']>;

type ResolvedFindReplaceConfig = {
  enabled: boolean;
  texts: ResolvedFindReplaceTexts;
  replaceEnabled: boolean;
  includeDeletedText?: boolean;
  component?: unknown;
  props?: Record<string, unknown>;
  render?: FindReplaceRenderer;
  resolver?: FindReplaceConfig['resolver'];
  floating?: SearchFloatingConfig;
};

type FindReplaceRendering = {
  suppressed?: boolean;
  component?: unknown;
  props?: Record<string, unknown>;
  render?: FindReplaceRenderer;
  builtin?: boolean;
};

type UseFindReplaceOptions = {
  getSurfaceManager: () => Pick<SurfaceManager, 'open'> | null;
  getActiveEditor: () => Editor | null;
  activeEditorRef?: Ref<Editor | null | undefined>;
  getFindReplaceConfig?: () => boolean | FindReplaceConfig | undefined;
  /**
   * Getter for the SuperDoc-owned UI controller (`superdoc.ui`). Its `.search`
   * slice is the single find/replace session authority.
   */
  getSuperDocUI?: () => { search?: FindReplaceSearch | null } | null | undefined;
};

const DEFAULT_TEXTS: ResolvedFindReplaceTexts = {
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
 * Composable that manages a find/replace floating surface.
 *
 * Owns all search state (query, toggles, match count, active index) and the
 * resolution chain for custom/external/built-in rendering. The component
 * receives a FindReplaceHandle with reactive state and actions.
 */
export function useFindReplace({
  getSurfaceManager,
  getActiveEditor,
  activeEditorRef,
  getFindReplaceConfig,
  getSuperDocUI,
}: UseFindReplaceOptions) {
  // ---- internal state -------------------------------------------------------

  let currentSurfaceHandle: SurfaceHandle | null = null;
  let currentEditor: Editor | null = null;
  /**
   * The `ui.search` handle for the current session, or null when the host
   * exposes none. Set at open() time.
   */
  let currentSearch: FindReplaceSearch | null = null;
  let destroyed = false;
  let opening = false; // sync guard against double-open across the await gap

  const isOpen = ref(false);

  /**
   * Ref to the find input element, set by the renderer via handle.registerFocusFn.
   */
  let focusFindInputFn: (() => void) | null = null;

  // ---- reactive state (owned by composable, consumed by renderers) ----------

  const findQuery = ref('');
  const replaceText = ref('');
  const caseSensitive = ref(false);
  const ignoreDiacritics = ref(false);
  const regex = ref(false);
  const showReplace = ref(false);
  const matchCount = ref(0);
  const activeMatchIndex = ref(-1);
  // Whether replace can mutate right now. Driven from the host search session
  // so viewing/read-only mode disables the replace controls.
  const canReplaceState = ref(true);
  // Whether replace-all can run right now. The host reports it separately:
  // a truncated session still replaces the active match but refuses to replace
  // every match it could not enumerate.
  const canReplaceAllState = ref(true);
  // Re-entrancy guard so a repeated click cannot issue overlapping mutations.
  const replacePending = ref(false);
  // The host search session has no ignore-diacritics mode, so surfaces hide
  // that toggle instead of shipping a no-op control.
  const ignoreDiacriticsSupported = ref(false);
  // Regex search needs a host search session (see open()).
  const regexSupported = ref(false);
  // Inline error label when the current regex pattern is invalid/unsafe.
  const searchError = ref<string | null>(null);

  /** Current resolved texts — updated on each open(). */
  let currentTexts = DEFAULT_TEXTS;

  const matchLabel = computed(() => {
    if (!findQuery.value) return '';
    if (matchCount.value === 0) return currentTexts.noResultsLabel;
    return `${activeMatchIndex.value + 1} of ${matchCount.value}`;
  });

  const hasMatches = computed(() => matchCount.value > 0);

  // Whether the replace controls should be enabled: there are matches, replace
  // is not in flight, and the active session allows mutation (read-only mode
  // sets `canReplaceState` false).
  const canReplaceComputed = computed(() => hasMatches.value && !replacePending.value && canReplaceState.value);
  // Replace all additionally needs the session to enumerate every match.
  const canReplaceAllComputed = computed(() => canReplaceComputed.value && canReplaceAllState.value);

  // ---- timers ---------------------------------------------------------------

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let syncInterval: ReturnType<typeof setInterval> | null = null;

  // ---- search session -------------------------------------------------------

  /**
   * Resolve the `ui.search` handle when available. Never throws.
   */
  function resolveSearch(): FindReplaceSearch | null {
    try {
      const ui = typeof getSuperDocUI === 'function' ? getSuperDocUI() : null;
      const search = ui?.search;
      return search && (typeof search.find === 'function' || typeof search.search === 'function') ? search : null;
    } catch {
      return null;
    }
  }

  /**
   * Sync the reactive match state from the current host search snapshot.
   */
  function applySlice(snapshot: unknown) {
    if (!snapshot) return;
    const slice: Partial<SearchSlice> = typeof snapshot === 'object' ? snapshot : {};
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
    const search = currentSearch;
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
      applySlice(slice);
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
    if (!currentSearch) return;
    try {
      currentSearch.next();
      applySlice(currentSearch.getSnapshot());
    } catch {
      /* host gone */
    }
  }

  function goPrev() {
    if (!hasMatches.value) return;
    if (!currentSearch) return;
    try {
      currentSearch.previous();
      applySlice(currentSearch.getSnapshot());
    } catch {
      /* host gone */
    }
  }

  function replaceCurrent() {
    if (!currentReplaceEnabled) return;
    if (replacePending.value) return;
    if (!hasMatches.value) return;
    if (!currentSearch) return;
    if (!canReplaceState.value) return;
    const search = currentSearch;
    replacePending.value = true;
    const finish = createReplaceContinuation(search, {
      getCurrentSession: () => currentSearch,
      applySlice,
      onSettled: () => {
        replacePending.value = false;
      },
    });
    let result: unknown = null;
    try {
      result = search.replace(replaceText.value);
    } catch {
      /* host gone */
    }
    // Worker-backed replace resolves asynchronously. Hold the pending flag
    // (which disables the replace controls) until the mutation settles so a
    // second click cannot start a concurrent replace.
    if (isThenable(result)) {
      void Promise.resolve(result).then(finish, finish);
    } else {
      finish();
    }
  }

  function replaceAll() {
    if (!currentReplaceEnabled) return;
    if (replacePending.value) return;
    if (!hasMatches.value) return;
    if (!currentSearch) return;
    if (!canReplaceState.value || !canReplaceAllState.value) return;
    const search = currentSearch;
    replacePending.value = true;
    const finish = createReplaceContinuation(search, {
      getCurrentSession: () => currentSearch,
      applySlice,
      onSettled: () => {
        replacePending.value = false;
      },
    });
    let result: unknown = null;
    try {
      result = search.replaceAll(replaceText.value);
    } catch {
      /* host gone */
    }
    // Worker-backed replace-all resolves asynchronously. Hold the pending
    // flag (which disables the replace controls) until the mutations settle
    // so a second click cannot start a concurrent replace-all.
    if (isThenable(result)) {
      void Promise.resolve(result).then(finish, finish);
    } else {
      finish();
    }
  }

  // ---- polling --------------------------------------------------------------

  function syncFromSearchSession() {
    if (!currentSearch) return;
    try {
      applySlice(currentSearch.getSnapshot());
    } catch {
      /* host gone */
    }
  }

  function startPolling() {
    stopPolling();
    syncInterval = setInterval(syncFromSearchSession, 200);
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
  function resolveConfig(): ResolvedFindReplaceConfig {
    const raw = typeof getFindReplaceConfig === 'function' ? getFindReplaceConfig() : undefined;

    if (raw === false || raw == null) {
      return { enabled: false, texts: DEFAULT_TEXTS, replaceEnabled: true };
    }

    if (raw === true) {
      return { enabled: true, texts: DEFAULT_TEXTS, replaceEnabled: true };
    }

    const cfg: FindReplaceConfig = typeof raw === 'object' ? raw : {};

    if (cfg.component != null && typeof cfg.render === 'function') {
      throw new Error('Search configuration cannot provide both "component" and "render". Use one or the other.');
    }

    const texts: ResolvedFindReplaceTexts = {
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
   */
  function resolveRendering(config: ResolvedFindReplaceConfig, resolverCtx: FindReplaceContext): FindReplaceRendering {
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
   */
  function createHandle(config: ResolvedFindReplaceConfig, closeFn: (reason?: unknown) => void): FindReplaceHandle {
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
       * `canReplace` plus the session enumerating every match. A truncated
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
   */
  function wrapHandleForExternal(handle: FindReplaceHandle) {
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
   * Clear the host search session (query, matches, highlights) when the given
   * editor is the current one, swallowing errors (the host may be gone).
   */
  function clearEditorSession(editor: Editor | null | undefined) {
    if (!editor) return;
    if (currentSearch && editor === currentEditor) {
      try {
        currentSearch.clear();
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

      const resolverCtx: FindReplaceContext = { texts: config.texts, replaceEnabled: config.replaceEnabled ?? true };
      const resolution = resolveRendering(config, resolverCtx);
      if (resolution.suppressed) return false;

      // Only claim the shortcut when the host actually exposes a usable search
      // facade. Otherwise fall through so browser-native Cmd+F still works
      // (worker/pre-ready hosts, or builds without the search substrate).
      const search = resolveSearch();
      if (!search) return false;
      try {
        if (search.getSnapshot?.().available !== true) return false;
      } catch {
        return false;
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

      const resolverCtx: FindReplaceContext = { texts: config.texts, replaceEnabled: config.replaceEnabled ?? true };
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
      const floatingOptions: SearchFloatingConfig = {
        placement: 'top-right',
        autoFocus: true,
        // The one-row find layout (field + query toggles + nav) needs more
        // room than the 360px floating default before queries truncate.
        width: 420,
        ...config.floating,
      };

      // If there was a previous editor with an open search session, clear it
      if (currentEditor && currentEditor !== editor) {
        clearEditorSession(currentEditor);
      }
      currentEditor = editor;
      currentSearch = resolveSearch();
      regexSupported.value = Boolean(currentSearch);
      // Seed session mutability from the live snapshot so read-only mode hides
      // the replace controls on open instead of after the first query/poll.
      if (currentSearch) {
        try {
          applySlice(currentSearch.getSnapshot());
        } catch {
          /* host gone */
        }
      }
      focusFindInputFn = null;

      // Late-wired close — the handle is created before the surface opens
      let lateCloseFn: (reason?: unknown) => void = () => {};

      const handle = createHandle(config, (reason) => lateCloseFn(reason));

      let surfaceHandle: SurfaceHandle;

      if (resolution.component) {
        // Custom Vue component (from resolver or direct config)
        surfaceHandle = manager.open({
          mode: 'floating',
          ariaLabel: config.texts.findAriaLabel,
          closeOnEscape: true,
          floating: floatingOptions,
          component: markRawComponent(resolution.component),
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
        // Built-in — lazy import.
        let FindReplaceSurface: unknown;
        try {
          const mod = await import('../components/surfaces/FindReplaceSurface.vue');
          FindReplaceSurface = mod.default;
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
          currentSearch = resolveSearch();
        }

        surfaceHandle = manager.open({
          mode: 'floating',
          ariaLabel: config.texts.findAriaLabel,
          component: markRawComponent(FindReplaceSurface),
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
    currentSearch = null;
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
