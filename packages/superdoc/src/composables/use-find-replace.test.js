// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test';
import { ref, nextTick } from 'vue';
import { useFindReplace } from './use-find-replace.js';

/** Monotonically increasing surface IDs for multi-open tests. */
let surfaceIdSeq = 0;

/**
 * Mock a surface manager with controllable settle behavior.
 * Each call to open() creates a fresh handle with a unique id.
 */
function createManagerStub() {
  const handles = [];

  const stub = {
    open: vi.fn(() => {
      let settleHandle;
      const handle = {
        id: `surface-${++surfaceIdSeq}`,
        mode: 'floating',
        close: vi.fn(),
        result: new Promise((resolve) => {
          settleHandle = resolve;
        }),
      };
      handle._settle = (outcome) => settleHandle(outcome);
      handles.push(handle);
      return handle;
    }),
    /** The most recently opened handle (convenience). */
    get lastHandle() {
      return handles[handles.length - 1] ?? null;
    },
    handles,
  };
  return stub;
}

function createEditorStub() {
  return {
    commands: {
      clearSearchSession: vi.fn(),
      setSearchSession: vi.fn(() => ({ matches: [], activeMatchIndex: -1 })),
      nextSearchMatch: vi.fn(() => ({ activeMatchIndex: 0, match: null })),
      previousSearchMatch: vi.fn(() => ({ activeMatchIndex: 0, match: null })),
      replaceSearchMatch: vi.fn(() => ({ matches: [], activeMatchIndex: -1 })),
      replaceAllSearchMatches: vi.fn(() => ({ replacedCount: 0 })),
    },
    extensionStorage: {
      Search: {
        searchResults: [],
        activeMatchIndex: -1,
      },
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('useFindReplace', () => {
  let manager;
  let editor;
  let activeEditorRef;
  let findReplace;
  let configValue;

  beforeEach(() => {
    surfaceIdSeq = 0;
    manager = createManagerStub();
    editor = createEditorStub();
    activeEditorRef = ref(editor);
    configValue = true;

    findReplace = useFindReplace({
      getSurfaceManager: () => manager,
      getActiveEditor: () => editor,
      activeEditorRef,
      getFindReplaceConfig: () => configValue,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('open()', () => {
    it('calls surfaceManager.open with floating mode', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(1);
      const call = manager.open.mock.calls[0][0];
      expect(call.mode).toBe('floating');
      expect(call.floating.placement).toBe('top-right');
      // closeOnEscape lives at the request top level — surface-manager
      // only reads `request.closeOnEscape`, not `request.floating.closeOnEscape`.
      // Asserting the nested location (as this test did before SD-2870) was
      // verifying the call shape but not the runtime effect.
      expect(call.closeOnEscape).toBe(true);
    });

    it('does not create second surface when already open', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      await findReplace.open();

      expect(manager.open).toHaveBeenCalledTimes(1);
    });

    it('sets isOpen to true', async () => {
      expect(findReplace.isOpen.value).toBe(false);

      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(findReplace.isOpen.value).toBe(true);
    });

    it('does nothing when no surface manager', async () => {
      const noManager = useFindReplace({
        getSurfaceManager: () => null,
        getActiveEditor: () => editor,
        getFindReplaceConfig: () => true,
      });

      await noManager.open();
      // No error thrown
    });

    it('does nothing when no active editor', async () => {
      const noActive = useFindReplace({
        getSurfaceManager: () => manager,
        getActiveEditor: () => null,
        getFindReplaceConfig: () => true,
      });

      await noActive.open();
      expect(manager.open).not.toHaveBeenCalled();
    });

    it('concurrent open() calls only produce one surface (race guard)', async () => {
      const p1 = findReplace.open();
      const p2 = findReplace.open();
      await Promise.all([p1, p2]);
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(1);
    });

    it('passes findReplace handle in props', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      const call = manager.open.mock.calls[0][0];
      expect(call.props.findReplace).toBeDefined();
      expect(typeof call.props.findReplace.goNext).toBe('function');
      expect(typeof call.props.findReplace.goPrev).toBe('function');
      expect(typeof call.props.findReplace.registerFocusFn).toBe('function');
    });

    it('does not open when config is false', async () => {
      configValue = false;
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).not.toHaveBeenCalled();
    });

    it('does not open when config is undefined', async () => {
      configValue = undefined;
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).not.toHaveBeenCalled();
    });

    it('opens when config is an object', async () => {
      configValue = { findPlaceholder: 'Search...' };
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(1);
    });

    it('does not open when resolver returns none', async () => {
      configValue = { resolver: () => ({ type: 'none' }) };
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).not.toHaveBeenCalled();
    });

    it('passes custom component to surface manager', async () => {
      const CustomComponent = { template: '<div />' };
      configValue = { component: CustomComponent };
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(1);
      const call = manager.open.mock.calls[0][0];
      // markRaw wraps the component, so check identity through the raw value
      expect(call.component).toBeDefined();
      expect(call.props.findReplace).toBeDefined();
    });

    it('passes external render function to surface manager', async () => {
      const renderFn = vi.fn();
      configValue = { render: renderFn };
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(1);
      const call = manager.open.mock.calls[0][0];
      expect(typeof call.render).toBe('function');
    });

    it('resolver custom overrides direct component', async () => {
      const DirectComponent = { template: '<div>direct</div>' };
      const ResolverComponent = { template: '<div>resolver</div>' };
      configValue = {
        component: DirectComponent,
        resolver: () => ({ type: 'custom', component: ResolverComponent }),
      };
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(1);
      const call = manager.open.mock.calls[0][0];
      // The resolver's component should win (it's raw-wrapped)
      expect(call.component).toBeDefined();
    });

    it('resolver returning null falls through to direct component', async () => {
      const DirectComponent = { template: '<div>direct</div>' };
      configValue = {
        component: DirectComponent,
        resolver: () => null,
      };
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(1);
      const call = manager.open.mock.calls[0][0];
      expect(call.component).toBeDefined();
    });

    it('resolver returning default falls through to built-in', async () => {
      configValue = {
        resolver: () => ({ type: 'default' }),
      };
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(1);
    });

    it('throws when both component and render are provided', async () => {
      configValue = { component: {}, render: () => {} };
      await expect(findReplace.open()).rejects.toThrow('cannot provide both');
    });

    it('resets opening guard after config validation error', async () => {
      configValue = { component: {}, render: () => {} };
      await findReplace.open().catch(() => {});

      // After the error, a valid config should still be openable
      configValue = true;
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(1);
    });

    it('resets opening guard after resolver throws', async () => {
      configValue = {
        resolver: () => {
          throw new Error('resolver boom');
        },
      };
      await findReplace.open().catch(() => {});

      configValue = true;
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(1);
    });

    it('passes ariaLabel to surface manager', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      const call = manager.open.mock.calls[0][0];
      expect(call.ariaLabel).toBe('Find text');
    });

    it('passes custom ariaLabel from text overrides', async () => {
      configValue = { findAriaLabel: 'Search document' };
      await findReplace.open();
      await vi.dynamicImportSettled();

      const call = manager.open.mock.calls[0][0];
      expect(call.ariaLabel).toBe('Search document');
    });
  });

  describe('close()', () => {
    it('calls handle.close', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      findReplace.close();

      expect(manager.lastHandle.close).toHaveBeenCalledWith('programmatic');
    });
  });

  describe('getSearchStorage fallback', () => {
    // `getSearchStorage` first tries `extensionStorage.Search` and
    // `storage.Search`. When neither carries a live session, it falls back
    // to scanning every key for an object with `searchIndex` and
    // `searchResults`. The fallback is what catches non-default extension
    // names; without an explicit test the polling path silently skips it.
    it('finds storage under a non-Search key via the fallback scan', async () => {
      // Editor with the Search extension registered under a custom key. The
      // direct `extensionStorage.Search` and `storage.Search` lookups miss;
      // the fallback iterates keys and matches on the structural probe.
      const customEditor = {
        commands: editor.commands,
        extensionStorage: {
          CustomFinder: {
            searchIndex: [{ from: 0, to: 1 }],
            searchResults: [
              { from: 0, to: 1 },
              { from: 5, to: 6 },
            ],
            activeMatchIndex: 1,
          },
        },
      };
      const customFindReplace = useFindReplace({
        getSurfaceManager: () => manager,
        getActiveEditor: () => customEditor,
        activeEditorRef: ref(customEditor),
        getFindReplaceConfig: () => true,
      });

      await customFindReplace.open();
      await vi.dynamicImportSettled();

      // The handle exposed to the surface component carries the live state
      // refs that polling syncs into.
      const findReplaceHandle = manager.open.mock.calls.at(-1)[0].props.findReplace;

      // Wait one polling tick (200 ms interval) so syncFromEditorStorage runs.
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(findReplaceHandle.matchCount.value).toBe(2);
      expect(findReplaceHandle.activeMatchIndex.value).toBe(1);

      customFindReplace.close();
    });
  });

  describe('surface close cleanup', () => {
    it('clears search session when surface settles as closed', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      manager.lastHandle._settle({ status: 'closed', reason: 'escape' });
      await tick();

      expect(editor.commands.clearSearchSession).toHaveBeenCalled();
      expect(findReplace.isOpen.value).toBe(false);
    });

    it('clears search session when surface settles as replaced', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      manager.lastHandle._settle({ status: 'replaced', replacedBy: 'some-other-surface' });
      await tick();

      expect(editor.commands.clearSearchSession).toHaveBeenCalled();
      expect(findReplace.isOpen.value).toBe(false);
    });

    it('stale settle callback does not clobber newer surface state', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      const firstHandle = manager.lastHandle;

      // Settle the first handle (simulating replacement by another surface)
      firstHandle._settle({ status: 'replaced', replacedBy: 'surface-2' });
      await tick();

      // Now open again (simulating the user re-pressing Cmd+F)
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(manager.open).toHaveBeenCalledTimes(2);
      expect(findReplace.isOpen.value).toBe(true);

      // The second handle's settle should not have been clobbered
      const secondHandle = manager.lastHandle;
      expect(secondHandle.id).not.toBe(firstHandle.id);
    });
  });

  describe('editor switch', () => {
    it('clears previous editor search and closes surface on editor switch', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      const newEditor = createEditorStub();
      activeEditorRef.value = newEditor;

      // Vue watcher fires async
      await tick();

      expect(editor.commands.clearSearchSession).toHaveBeenCalled();
      expect(manager.lastHandle.close).toHaveBeenCalled();
    });
  });

  describe('destroy()', () => {
    it('closes open surface and prevents future opens', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      const handle = manager.lastHandle;
      findReplace.destroy();

      expect(handle.close).toHaveBeenCalled();

      // Reset mock
      manager.open.mockClear();

      await findReplace.open();
      expect(manager.open).not.toHaveBeenCalled();
    });
  });

  describe('wouldOpen()', () => {
    it('returns true when config is true and editor is present', () => {
      expect(findReplace.wouldOpen()).toBe(true);
    });

    it('returns false when config is false', () => {
      configValue = false;
      expect(findReplace.wouldOpen()).toBe(false);
    });

    it('returns false when config is undefined', () => {
      configValue = undefined;
      expect(findReplace.wouldOpen()).toBe(false);
    });

    it('returns false when resolver returns none', () => {
      configValue = { resolver: () => ({ type: 'none' }) };
      expect(findReplace.wouldOpen()).toBe(false);
    });

    it('returns false when resolver throws (does not propagate error)', () => {
      configValue = {
        resolver: () => {
          throw new Error('boom');
        },
      };
      expect(findReplace.wouldOpen()).toBe(false);
    });

    it('returns false when config is invalid (component + render)', () => {
      configValue = { component: {}, render: () => {} };
      expect(findReplace.wouldOpen()).toBe(false);
    });

    it('returns false when no editor', () => {
      const noEditor = useFindReplace({
        getSurfaceManager: () => manager,
        getActiveEditor: () => null,
        getFindReplaceConfig: () => true,
      });
      expect(noEditor.wouldOpen()).toBe(false);
    });

    it('returns false when no surface manager', () => {
      const noManager = useFindReplace({
        getSurfaceManager: () => null,
        getActiveEditor: () => editor,
        getFindReplaceConfig: () => true,
      });
      expect(noManager.wouldOpen()).toBe(false);
    });

    it('returns false after destroy', async () => {
      findReplace.destroy();
      expect(findReplace.wouldOpen()).toBe(false);
    });

    it('returns true when already open (will refocus)', async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();

      expect(findReplace.wouldOpen()).toBe(true);
    });
  });

  describe('config resolution', () => {
    it('resolves text overrides from object config', async () => {
      configValue = { findPlaceholder: 'Search...', noResultsLabel: 'Nothing found' };
      await findReplace.open();
      await vi.dynamicImportSettled();

      const handle = manager.open.mock.calls[0][0].props.findReplace;
      expect(handle.texts.findPlaceholder).toBe('Search...');
      expect(handle.texts.noResultsLabel).toBe('Nothing found');
      // Non-overridden fields get defaults
      expect(handle.texts.replaceLabel).toBe('Replace');
    });

    it('replaceEnabled defaults to true', async () => {
      configValue = {};
      await findReplace.open();
      await vi.dynamicImportSettled();

      const handle = manager.open.mock.calls[0][0].props.findReplace;
      expect(handle.replaceEnabled).toBe(true);
    });

    it('replaceEnabled: false is reflected in handle', async () => {
      configValue = { replaceEnabled: false };
      await findReplace.open();
      await vi.dynamicImportSettled();

      const handle = manager.open.mock.calls[0][0].props.findReplace;
      expect(handle.replaceEnabled).toBe(false);
    });
  });

  describe('handle actions', () => {
    let handle;

    beforeEach(async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();
      handle = manager.open.mock.calls[0][0].props.findReplace;
    });

    it('goNext calls editor.commands.nextSearchMatch', () => {
      // Set up some matches first
      handle.findQuery.value = 'test';
      editor.commands.setSearchSession.mockReturnValue({ matches: [{}], activeMatchIndex: 0 });

      // Manually set matchCount to simulate a search result
      // The watcher runs async, so we directly set the state for this test
      handle.matchCount.value = 1;

      handle.goNext();
      expect(editor.commands.nextSearchMatch).toHaveBeenCalled();
    });

    it('goPrev calls editor.commands.previousSearchMatch', () => {
      handle.matchCount.value = 1;

      handle.goPrev();
      expect(editor.commands.previousSearchMatch).toHaveBeenCalled();
    });

    it('replaceCurrent calls editor.commands.replaceSearchMatch', () => {
      handle.matchCount.value = 1;
      handle.replaceText.value = 'new text';

      handle.replaceCurrent();
      expect(editor.commands.replaceSearchMatch).toHaveBeenCalledWith('new text');
    });

    it('replaceAll calls editor.commands.replaceAllSearchMatches', () => {
      handle.matchCount.value = 1;
      handle.replaceText.value = 'new text';

      handle.replaceAll();
      expect(editor.commands.replaceAllSearchMatches).toHaveBeenCalledWith('new text');
    });

    it('replaceCurrent is a no-op when replaceEnabled is false', async () => {
      // Close and reopen with replaceEnabled: false
      manager.lastHandle._settle({ status: 'closed' });
      await tick();

      configValue = { replaceEnabled: false };
      await findReplace.open();
      await vi.dynamicImportSettled();

      const newHandle = manager.open.mock.calls[1][0].props.findReplace;
      newHandle.matchCount.value = 1;
      newHandle.replaceText.value = 'new text';

      newHandle.replaceCurrent();
      expect(editor.commands.replaceSearchMatch).not.toHaveBeenCalled();
    });

    it('replaceAll is a no-op when replaceEnabled is false', async () => {
      // Close and reopen with replaceEnabled: false
      manager.lastHandle._settle({ status: 'closed' });
      await tick();

      configValue = { replaceEnabled: false };
      await findReplace.open();
      await vi.dynamicImportSettled();

      const newHandle = manager.open.mock.calls[1][0].props.findReplace;
      newHandle.matchCount.value = 1;
      newHandle.replaceText.value = 'new text';

      newHandle.replaceAll();
      expect(editor.commands.replaceAllSearchMatches).not.toHaveBeenCalled();
    });

    it('registerFocusFn stores the function', () => {
      const focusFn = vi.fn();
      handle.registerFocusFn(focusFn);

      // The composable should call this when open() is called while already open
      // We can verify by opening again
      findReplace.open();
      expect(focusFn).toHaveBeenCalled();
    });

    it('runs search sessions with visible search model', async () => {
      handle.findQuery.value = 'tracked';
      await new Promise((resolve) => setTimeout(resolve, 180));

      expect(editor.commands.setSearchSession).toHaveBeenCalledWith(
        'tracked',
        expect.objectContaining({
          searchModel: 'visible',
        }),
      );
    });

    it('uses raw search model when includeDeletedText is true in config', async () => {
      manager.lastHandle._settle({ status: 'closed' });
      await tick();

      const customEditor = createEditorStub();
      const fr = useFindReplace({
        getSurfaceManager: () => manager,
        getActiveEditor: () => customEditor,
        activeEditorRef: ref(customEditor),
        getFindReplaceConfig: () => ({ includeDeletedText: true }),
      });

      await fr.open();
      await vi.dynamicImportSettled();
      const customHandle = manager.open.mock.calls.at(-1)[0].props.findReplace;

      customHandle.findQuery.value = 'deleted';
      await new Promise((resolve) => setTimeout(resolve, 180));

      expect(customEditor.commands.setSearchSession).toHaveBeenCalledWith(
        'deleted',
        expect.objectContaining({
          searchModel: 'raw',
        }),
      );
    });
  });

  describe('handle reactive state', () => {
    let handle;

    beforeEach(async () => {
      await findReplace.open();
      await vi.dynamicImportSettled();
      handle = manager.open.mock.calls[0][0].props.findReplace;
    });

    it('matchLabel is empty when no query', () => {
      expect(handle.matchLabel.value).toBe('');
    });

    it('matchLabel shows "No results" when query has no matches', async () => {
      handle.findQuery.value = 'test';
      // matchCount stays at 0
      await nextTick();
      expect(handle.matchLabel.value).toBe('No results');
    });

    it('matchLabel uses custom noResultsLabel', async () => {
      manager.lastHandle._settle({ status: 'closed' });
      await tick();

      configValue = { noResultsLabel: 'Nothing found' };
      await findReplace.open();
      await vi.dynamicImportSettled();

      const newHandle = manager.open.mock.calls[1][0].props.findReplace;
      newHandle.findQuery.value = 'test';
      await nextTick();
      expect(newHandle.matchLabel.value).toBe('Nothing found');
    });

    it('hasMatches reflects matchCount', () => {
      expect(handle.hasMatches.value).toBe(false);
      handle.matchCount.value = 3;
      expect(handle.hasMatches.value).toBe(true);
    });

    it('state is reset between opens', async () => {
      handle.findQuery.value = 'old query';
      handle.matchCount.value = 5;

      manager.lastHandle._settle({ status: 'closed' });
      await tick();

      await findReplace.open();
      await vi.dynamicImportSettled();

      const newHandle = manager.open.mock.calls[1][0].props.findReplace;
      expect(newHandle.findQuery.value).toBe('');
      expect(newHandle.matchCount.value).toBe(0);
    });
  });

  describe('v2 driver (host.search via ui.search)', () => {
    /** A V2 active editor facade — no command-backed search API. */
    function createV2Editor() {
      return { editorVersion: 2 };
    }

    /** Stateful `ui.search` stub mirroring the host search session contract. */
    function createV2SearchStub({ canReplace = true, canReplaceAll = canReplace, available = true } = {}) {
      const state = {
        query: '',
        total: 0,
        activeIndex: -1,
        canReplace,
        canReplaceAll: false,
        available,
        includeTrackedDeletions: false,
      };
      return {
        getSnapshot: vi.fn(() => ({ ...state })),
        find: vi.fn((query, options = {}) => {
          state.query = query;
          state.total = query ? 2 : 0;
          state.activeIndex = query ? 0 : -1;
          state.canReplaceAll = state.total > 0 && canReplaceAll;
          state.includeTrackedDeletions = options.includeTrackedDeletions === true;
          return { ...state };
        }),
        next: vi.fn(() => {
          if (state.total > 0) state.activeIndex = (state.activeIndex + 1) % state.total;
          return { ok: true };
        }),
        previous: vi.fn(() => {
          if (state.total > 0) state.activeIndex = (state.activeIndex - 1 + state.total) % state.total;
          return { ok: true };
        }),
        clear: vi.fn(() => {
          state.query = '';
          state.total = 0;
          state.activeIndex = -1;
        }),
        replace: vi.fn(() => {
          state.total = Math.max(0, state.total - 1);
          state.activeIndex = state.total > 0 ? Math.min(state.activeIndex, state.total - 1) : -1;
          return { ok: true };
        }),
        replaceAll: vi.fn(() => {
          state.total = 0;
          state.activeIndex = -1;
          return { ok: true };
        }),
      };
    }

    function makeV2({ canReplace = true, canReplaceAll = canReplace, available = true } = {}) {
      const v2Editor = createV2Editor();
      const search = createV2SearchStub({ canReplace, canReplaceAll, available });
      const fr = useFindReplace({
        getSurfaceManager: () => manager,
        getActiveEditor: () => v2Editor,
        activeEditorRef: ref(v2Editor),
        getFindReplaceConfig: () => true,
        getSuperDocUI: () => ({ search }),
      });
      return { fr, search };
    }

    it('wouldOpen requires the host search facade to be available', () => {
      const unavailable = makeV2({ available: false });
      expect(unavailable.fr.wouldOpen()).toBe(false);

      const noUi = useFindReplace({
        getSurfaceManager: () => manager,
        getActiveEditor: () => createV2Editor(),
        getFindReplaceConfig: () => true,
        getSuperDocUI: () => null,
      });
      expect(noUi.wouldOpen()).toBe(false);

      const available = makeV2();
      expect(available.fr.wouldOpen()).toBe(true);
    });

    it('keeps older ui.search handles working while preferring find()', async () => {
      const v2Editor = createV2Editor();
      const search = createV2SearchStub();
      search.search = search.find;
      delete search.find;
      const fr = useFindReplace({
        getSurfaceManager: () => manager,
        getActiveEditor: () => v2Editor,
        activeEditorRef: ref(v2Editor),
        getFindReplaceConfig: () => ({ includeDeletedText: true }),
        getSuperDocUI: () => ({ search }),
      });

      expect(fr.wouldOpen()).toBe(true);
      await fr.open();
      await vi.dynamicImportSettled();
      const handle = manager.open.mock.calls.at(-1)[0].props.findReplace;
      handle.findQuery.value = 'needle';
      await new Promise((resolve) => setTimeout(resolve, 180));

      expect(search.search).toHaveBeenCalledWith('needle', {
        caseSensitive: false,
        includeDeletedText: true,
        regex: false,
      });
      fr.close();
    });

    it('routes query and navigation through ui.search', async () => {
      const { fr, search } = makeV2();
      await fr.open();
      await vi.dynamicImportSettled();
      const handle = manager.open.mock.calls.at(-1)[0].props.findReplace;

      handle.findQuery.value = 'needle';
      await new Promise((resolve) => setTimeout(resolve, 180));
      expect(search.find).toHaveBeenCalledWith('needle', {
        caseSensitive: false,
        includeTrackedDeletions: false,
        regex: false,
      });
      expect(handle.matchCount.value).toBe(2);
      expect(handle.activeMatchIndex.value).toBe(0);

      handle.goNext();
      expect(search.next).toHaveBeenCalled();
      expect(handle.activeMatchIndex.value).toBe(1);

      handle.goPrev();
      expect(search.previous).toHaveBeenCalled();
      expect(handle.activeMatchIndex.value).toBe(0);

      fr.close();
    });

    it('threads the regex toggle into ui.search and surfaces invalid-pattern errors (SD-3569)', async () => {
      const v2Editor = createV2Editor();
      const search = createV2SearchStub();
      search.find = vi.fn((query, options = {}) => ({
        query,
        total: options.regex && query === '(' ? 0 : 1,
        activeIndex: options.regex && query === '(' ? -1 : 0,
        canReplace: true,
        available: true,
        includeTrackedDeletions: false,
        regex: options.regex === true,
        reason: options.regex && query === '(' ? 'search-invalid-pattern' : undefined,
      }));
      const fr = useFindReplace({
        getSurfaceManager: () => manager,
        getActiveEditor: () => v2Editor,
        activeEditorRef: ref(v2Editor),
        getFindReplaceConfig: () => true,
        getSuperDocUI: () => ({ search }),
      });

      await fr.open();
      await vi.dynamicImportSettled();
      const handle = manager.open.mock.calls.at(-1)[0].props.findReplace;

      // The V2 driver exposes the regex toggle.
      expect(handle.regexSupported.value).toBe(true);

      handle.regex.value = true;
      handle.findQuery.value = 'nee(dle)';
      await new Promise((resolve) => setTimeout(resolve, 180));
      expect(search.find).toHaveBeenCalledWith('nee(dle)', {
        caseSensitive: false,
        includeTrackedDeletions: false,
        regex: true,
      });
      expect(handle.searchError.value).toBe(null);

      // Invalid pattern surfaces the inline error label without a crash.
      handle.findQuery.value = '(';
      await new Promise((resolve) => setTimeout(resolve, 180));
      expect(handle.searchError.value).toBe('Invalid pattern');
      expect(handle.matchCount.value).toBe(0);

      // A valid query clears the error.
      handle.findQuery.value = 'needle';
      await new Promise((resolve) => setTimeout(resolve, 180));
      expect(handle.searchError.value).toBe(null);

      fr.close();
    });

    it('passes tracked deletions from config into ui.search on v2', async () => {
      const v2Editor = createV2Editor();
      const search = createV2SearchStub();
      const fr = useFindReplace({
        getSurfaceManager: () => manager,
        getActiveEditor: () => v2Editor,
        activeEditorRef: ref(v2Editor),
        getFindReplaceConfig: () => ({ includeDeletedText: true }),
        getSuperDocUI: () => ({ search }),
      });

      await fr.open();
      await vi.dynamicImportSettled();
      const handle = manager.open.mock.calls.at(-1)[0].props.findReplace;

      handle.findQuery.value = 'needle';
      await new Promise((resolve) => setTimeout(resolve, 180));
      expect(search.find).toHaveBeenCalledWith('needle', {
        caseSensitive: false,
        includeTrackedDeletions: true,
        regex: false,
      });

      fr.close();
    });

    it('replaceCurrent / replaceAll mutate through ui.search and refresh state', async () => {
      const { fr, search } = makeV2();
      await fr.open();
      await vi.dynamicImportSettled();
      const handle = manager.open.mock.calls.at(-1)[0].props.findReplace;

      handle.findQuery.value = 'needle';
      await new Promise((resolve) => setTimeout(resolve, 180));

      handle.replaceText.value = 'pin';
      handle.replaceCurrent();
      expect(search.replace).toHaveBeenCalledWith('pin');
      expect(handle.matchCount.value).toBe(1);

      handle.replaceAll();
      expect(search.replaceAll).toHaveBeenCalledWith('pin');
      expect(handle.matchCount.value).toBe(0);

      fr.close();
    });

    it('holds replacePending across an async (worker) replace and blocks re-entry', async () => {
      const { fr, search } = makeV2();
      let resolveReplace;
      search.replace.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveReplace = resolve;
          }),
      );
      await fr.open();
      await vi.dynamicImportSettled();
      const handle = manager.open.mock.calls.at(-1)[0].props.findReplace;

      handle.findQuery.value = 'needle';
      await new Promise((resolve) => setTimeout(resolve, 180));

      handle.replaceText.value = 'pin';
      handle.replaceCurrent();
      // The worker mutation has not settled: pending must hold so the replace
      // controls stay disabled and a second click cannot start a concurrent
      // replace.
      expect(handle.replacePending.value).toBe(true);
      handle.replaceCurrent();
      expect(search.replace).toHaveBeenCalledTimes(1);

      resolveReplace({ ok: true });
      await tick();
      await tick();
      expect(handle.replacePending.value).toBe(false);
      fr.close();
    });

    it('keeps Replace enabled and refuses Replace all for a truncated session', async () => {
      const { fr, search } = makeV2({ canReplace: true, canReplaceAll: false });
      await fr.open();
      await vi.dynamicImportSettled();
      const handle = manager.open.mock.calls.at(-1)[0].props.findReplace;

      handle.findQuery.value = 'needle';
      await new Promise((resolve) => setTimeout(resolve, 180));

      expect(handle.canReplace.value).toBe(true);
      expect(handle.canReplaceAll.value).toBe(false);

      handle.replaceText.value = 'pin';
      handle.replaceAll();
      expect(search.replaceAll).not.toHaveBeenCalled();
      handle.replaceCurrent();
      expect(search.replace).toHaveBeenCalledTimes(1);
      fr.close();
    });

    it('disables replace and hides ignore-diacritics in read-only mode', async () => {
      const { fr, search } = makeV2({ canReplace: false });
      await fr.open();
      await vi.dynamicImportSettled();
      const handle = manager.open.mock.calls.at(-1)[0].props.findReplace;

      handle.findQuery.value = 'needle';
      await new Promise((resolve) => setTimeout(resolve, 180));

      expect(handle.canReplace.value).toBe(false);
      // V2 does not support ignore-diacritics search.
      expect(handle.ignoreDiacriticsSupported.value).toBe(false);

      handle.replaceText.value = 'pin';
      handle.replaceCurrent();
      handle.replaceAll();
      expect(search.replace).not.toHaveBeenCalled();
      expect(search.replaceAll).not.toHaveBeenCalled();

      fr.close();
    });

    it('clears the host search session on close', async () => {
      const { fr, search } = makeV2();
      await fr.open();
      await vi.dynamicImportSettled();

      manager.lastHandle._settle({ status: 'closed', reason: 'escape' });
      await tick();

      expect(search.clear).toHaveBeenCalled();
      expect(fr.isOpen.value).toBe(false);
    });
  });

  describe('external render wrapping', () => {
    it('external render receives wrapped handle with plain getters/setters', async () => {
      let capturedCtx;
      configValue = {
        render: (ctx) => {
          capturedCtx = ctx;
        },
      };
      await findReplace.open();
      await vi.dynamicImportSettled();

      // The surface manager receives a render function; invoke it
      const renderFn = manager.open.mock.calls[0][0].render;
      const mockSurfaceCtx = {
        container: document.createElement('div'),
        surfaceId: 'test',
        mode: 'floating',
        request: {},
        resolve: vi.fn(),
        close: vi.fn(),
      };
      renderFn(mockSurfaceCtx);

      // The external context should have unwrapped getters
      expect(capturedCtx).toBeDefined();
      expect(capturedCtx.findReplace).toBeDefined();
      expect(typeof capturedCtx.findReplace.findQuery).toBe('string');
      expect(typeof capturedCtx.findReplace.goNext).toBe('function');

      // Setting via the wrapper should update the underlying ref
      capturedCtx.findReplace.findQuery = 'hello';
      expect(capturedCtx.findReplace.findQuery).toBe('hello');
    });
  });
});
