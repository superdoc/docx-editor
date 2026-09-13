/**
 * v2-native React bindings for the `superdoc/ui` controller.
 *
 * Provider + hooks over the SuperDoc-owned controller (`superdoc.ui`). For a
 * real `SuperDoc` this layer never creates or destroys a controller; it binds
 * to the one the instance already owns. It falls back to building (and then
 * owning) one only for a structural host that carries no `ui`, since
 * `SuperDocHost` leaves that property optional. Authored with
 * `React.createElement` (no JSX) so the
 * library build needs no JSX transform, and `react` stays an external/optional
 * peer. No v1 editor or private v2 runtime imports.
 */

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';

import { createSuperDocUI } from './create-super-doc-ui.js';
import { toSliceSource } from './slice-source.js';
import type { SliceSource } from './slice-source.js';

import type {
  BorrowedSuperDocUI,
  CommandExecutionResult,
  CommandId,
  CommandState,
  CommentsSlice,
  ContentControlsSlice,
  DocumentSlice,
  FontFamilyOption,
  FontSizeOption,
  SearchSnapshot,
  SelectionSlice,
  Subscribable,
  SuperDocLike,
  SuperDocUI,
  ToolbarSnapshotSlice,
  TrackChangesSlice,
  ZoomSlice,
} from './types.js';

/** The raw SuperDoc instance (or host stub) handed to the provider. */
export type SuperDocHost = SuperDocLike;

interface SuperDocUIContextValue {
  ui: BorrowedSuperDocUI | null;
  host: SuperDocHost | null;
  setSuperDoc: (superdoc: SuperDocHost) => void;
}

const SuperDocUIContext = createContext<SuperDocUIContextValue | null>(null);

/**
 * Destroy a controller this provider built itself. Controllers read off
 * `superdoc.ui` are never passed here: the instance owns those.
 */
function disposeOwnedUi(ref: MutableRefObject<SuperDocUI | null>): void {
  const ui = ref.current;
  if (!ui) return;
  ui.destroy();
  ref.current = null;
}

/** Props accepted by {@link SuperDocUIProvider}. */
export interface SuperDocUIProviderProps {
  /** Child tree that consumes the controller via hooks. */
  children?: ReactNode;
}

/**
 * Root provider. Call {@link useSetSuperDoc} from your editor-mount
 * component's ready callback to bind a running SuperDoc instance; the hooks
 * below then read that instance's own controller (`superdoc.ui`).
 *
 * The provider is a consumer, not an owner. SuperDoc creates the controller
 * and destroys it in `superdoc.destroy()`, so unmounting or rebinding the
 * provider leaves it running for the built-in toolbar and any other consumer
 * of the same instance. Every React hook therefore observes the same command
 * state the rest of the application sees.
 */
export function SuperDocUIProvider(props: SuperDocUIProviderProps) {
  const [ui, setUi] = useState<BorrowedSuperDocUI | null>(null);
  const [host, setHost] = useState<SuperDocHost | null>(null);
  /** Only ever holds a controller this provider created for a host lacking one. */
  const ownedUiRef = useRef<SuperDocUI | null>(null);

  const setSuperDoc = useCallback((superdoc: SuperDocHost) => {
    // `SuperDocHost` is structural and its `ui` is optional, so a custom
    // adapter or test host can satisfy the type without carrying a
    // controller. A real `SuperDoc` always does. Falling back to the factory
    // for the rest keeps those hosts working instead of silently binding
    // nothing; the fallback is owned here, so it is the one controller this
    // provider is allowed to destroy.
    //
    // Read the accessor exactly once: `SuperDoc` caches its getter, but a
    // structural host's need not, and a second read could hand back a
    // different controller than the one we published.
    const hostUi = superdoc.ui;

    disposeOwnedUi(ownedUiRef);
    if (hostUi) {
      setUi(hostUi);
    } else {
      const created = createSuperDocUI({ superdoc });
      ownedUiRef.current = created;
      setUi(created);
    }
    setHost(superdoc);
  }, []);

  useEffect(() => () => disposeOwnedUi(ownedUiRef), []);

  const value: SuperDocUIContextValue = { ui, host, setSuperDoc };
  return createElement(SuperDocUIContext.Provider, { value }, props.children);
}

function useContextValue(): SuperDocUIContextValue {
  const value = useContext(SuperDocUIContext);
  if (!value) {
    throw new Error('[superdoc/ui/react] hooks must be used within <SuperDocUIProvider>.');
  }
  return value;
}

/**
 * Read the controller, or `null` until a SuperDoc instance is bound.
 *
 * Borrowed: the bound instance owns teardown, so the returned type omits
 * `destroy()`. A provider-built fallback controller is disposed by the provider.
 */
export function useSuperDocUI(): BorrowedSuperDocUI | null {
  return useContextValue().ui;
}

/** Read the raw bound SuperDoc host, or `null` until one is bound. */
export function useSuperDocHost(): SuperDocHost | null {
  return useContextValue().host;
}

/** Get the stable callback used to bind a running SuperDoc instance. */
export function useSetSuperDoc(): (superdoc: SuperDocHost) => void {
  return useContextValue().setSuperDoc;
}

// Shared with `./vue.ts`; see `./slice-source.ts` for the normalization
// contract. Re-exported here so existing unit tests keep their import path.
export { toSliceSource };

/**
 * Subscribe to a derived slice of controller state. `pick` selects a value
 * source from the controller: a domain handle / snapshot source
 * ({@link SliceSource}) or a raw `ui.select(...)` {@link Subscribable}, both
 * normalized via {@link toSliceSource}. `initial` is returned until the
 * controller is bound.
 */
export function useSuperDocSlice<T>(pick: (ui: BorrowedSuperDocUI) => SliceSource<T> | Subscribable<T>, initial: T): T {
  const ui = useSuperDocUI();
  const [value, setValue] = useState<T>(() => (ui ? toSliceSource(pick(ui)).getSnapshot() : initial));

  useEffect(() => {
    if (!ui) {
      setValue(initial);
      return;
    }
    const source = toSliceSource(pick(ui));
    setValue(source.getSnapshot());
    // `observe` emits the current snapshot immediately, then on each change.
    return source.observe(setValue);
    // `pick`/`initial` intentionally excluded: re-subscribe only when the
    // controller identity changes, matching the documented hook contract.
  }, [ui]);

  return value;
}

const EMPTY_SELECTION: SelectionSlice = {
  status: 'pending',
  empty: true,
  target: null,
  selectionTarget: null,
  activeMarks: [],
  activeCommentIds: [],
  activeChangeIds: [],
  quotedText: '',
};

/** Subscribe to the selection slice. */
export function useSuperDocSelection(): SelectionSlice {
  return useSuperDocSlice((ui) => ui.selection, EMPTY_SELECTION);
}

/** Subscribe to the current Search session. */
export function useSuperDocSearch(): SearchSnapshot {
  return useSuperDocSlice((ui) => ui.search, {
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
  });
}

/** Subscribe to the comments slice. */
export function useSuperDocComments(): CommentsSlice {
  return useSuperDocSlice((ui) => ui.comments, {
    status: 'pending',
    listStatus: 'pending',
    items: [],
    total: 0,
    activeIds: [],
    activeId: null,
  });
}

/** Subscribe to the content-controls slice. */
export function useSuperDocContentControls(): ContentControlsSlice {
  // Explicit type argument: `ContentControlsHandle.get` is overloaded (slice
  // read + by-id lookup), so inferring the slice type from the handle would
  // pick up the by-id overload's `ContentControlInfo | null` as well.
  return useSuperDocSlice<ContentControlsSlice>((ui) => ui.contentControls, {
    status: 'pending',
    items: [],
    total: 0,
    activeId: null,
    activeIds: [],
  });
}

/** Subscribe to the track-changes slice. */
export function useSuperDocTrackChanges(): TrackChangesSlice {
  return useSuperDocSlice((ui) => ui.trackChanges, {
    status: 'pending',
    items: [],
    total: 0,
    activeId: null,
    authors: [],
  });
}

/** Subscribe to the toolbar snapshot slice. */
export function useSuperDocToolbar(): ToolbarSnapshotSlice {
  return useSuperDocSlice((ui) => ui.toolbar, { context: null, commands: {}, copyFormatActive: false });
}

const EMPTY_COMMAND_STATE: CommandState = { enabled: false, active: false, supported: false };

/** Reactive state and execution methods for one SuperDoc command. */
export interface UseSuperDocCommandResult extends CommandState {
  /** Run the command against the currently bound Editor. */
  execute(payload?: unknown): CommandExecutionResult;
  /** Run the command and await the routed operation's settled result. */
  executeAsync(payload?: unknown): Promise<CommandExecutionResult>;
}

/** Subscribe to and execute one SuperDoc command. */
export function useSuperDocCommand(id: CommandId): UseSuperDocCommandResult {
  const ui = useSuperDocUI();
  const [observed, setObserved] = useState<{ id: CommandId; ui: BorrowedSuperDocUI | null; state: CommandState }>(
    () => ({ id, ui, state: ui ? ui.commands.get(id).getState() : EMPTY_COMMAND_STATE }),
  );

  useEffect(() => {
    if (!ui) {
      setObserved({ id, ui, state: EMPTY_COMMAND_STATE });
      return;
    }
    const command = ui.commands.get(id);
    const publish = (state: CommandState): void => setObserved({ id, ui, state });
    publish(command.getState());
    return command.observe(publish);
  }, [id, ui]);

  // The subscription only moves to a new `id` or controller in the effect, so
  // the committed render in between would pair the previous command's state
  // with `execute` callbacks that already target the new one. Read the current
  // command's state synchronously for that render instead of serving the old.
  const state =
    observed.id === id && observed.ui === ui
      ? observed.state
      : ui
        ? ui.commands.get(id).getState()
        : EMPTY_COMMAND_STATE;

  const execute = useCallback(
    (payload?: unknown): CommandExecutionResult => (ui ? ui.commands.execute(id, payload) : false),
    [id, ui],
  );
  const executeAsync = useCallback(
    (payload?: unknown): Promise<CommandExecutionResult> =>
      ui ? ui.commands.executeAsync(id, payload) : Promise.resolve(false),
    [id, ui],
  );

  return { ...state, execute, executeAsync };
}

/** Subscribe to the document slice. */
export function useSuperDocDocument(): DocumentSlice {
  return useSuperDocSlice((ui) => ui.document, { ready: false, mode: null, dirty: false });
}

/** Subscribe to available font-family options. */
export function useSuperDocFontOptions(): readonly FontFamilyOption[] {
  return useSuperDocSlice(
    (ui) => ({
      getSnapshot: () => ui.fonts.getFamilyOptions(),
      observe: (cb: (value: readonly FontFamilyOption[]) => void) => ui.fonts.observe((slice) => cb(slice.options)),
    }),
    [],
  );
}

/** Subscribe to available font-size options. */
export function useSuperDocFontSizeOptions(): readonly FontSizeOption[] {
  return useSuperDocSlice(
    (ui) => ({
      getSnapshot: () => ui.fonts.getSizeOptions(),
      observe: (cb: (value: readonly FontSizeOption[]) => void) => ui.fonts.observe((slice) => cb(slice.sizeOptions)),
    }),
    [],
  );
}

/** Subscribe to the zoom slice. */
export function useSuperDocZoom(): ZoomSlice {
  return useSuperDocSlice((ui) => ui.zoom, { mode: null, value: 100, min: 10, max: 100 });
}
