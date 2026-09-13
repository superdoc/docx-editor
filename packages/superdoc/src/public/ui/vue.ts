/**
 * v2-native Vue bindings for the `superdoc/ui` controller.
 *
 * Provider composable + slice composables over the SuperDoc-owned controller
 * (`superdoc.ui`). For a real `SuperDoc` this layer never creates or destroys
 * a controller; it binds to the one the instance already owns. It falls back
 * to building (and then owning) one only for a structural host that carries no
 * `ui`, since `SuperDocHost` leaves that property optional. Plain `.ts`, no
 * SFC compiler involved; `vue` is already a dependency of this package and an
 * external of its build. No v1 editor or private v2 runtime imports.
 *
 * Ownership and subscription semantics intentionally match `./react.ts`; the
 * ownership contract is pinned by `vue-provider-ownership.test.ts` the same
 * way `react-provider-ownership.test.ts` pins the React side.
 *
 * Requires one Vue instance shared with the host application. `vue` is external
 * to this package's build, so these composables call `provide`/`inject` from
 * whichever `vue` the consumer's resolution hands them. An application on a Vue
 * outside this package's dependency range can be given a second, nested copy,
 * and because Vue's composition context is per module instance the provider
 * then publishes into a context the consumer never reads. Nothing throws at
 * import time; the first composable call reports it as a missing provider.
 * Deduplicate Vue (a resolution/alias override, or a Vue matching the declared
 * range) if that error appears with a provider plainly in the tree.
 */

import { computed, inject, onScopeDispose, provide, shallowRef, toRaw, toValue, watch } from 'vue';
import type { ComputedRef, InjectionKey, MaybeRefOrGetter, ShallowRef } from 'vue';

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

/**
 * What {@link provideSuperDocUI} publishes to descendants and returns to its
 * caller. The refs are typed read-only: the provider is the only writer.
 */
export interface SuperDocUIBinding {
  /** The bound controller, or `null` until a SuperDoc instance is bound. */
  ui: Readonly<ShallowRef<BorrowedSuperDocUI | null>>;
  /** The raw bound SuperDoc host, or `null` until one is bound. */
  host: Readonly<ShallowRef<SuperDocHost | null>>;
  /** Bind a running SuperDoc instance. Stable function identity. */
  setSuperDoc: (superdoc: SuperDocHost) => void;
  /**
   * Unbind `expectedHost`, returning whether it was still the bound one. The
   * host is required: teardown races with rebinding, so an unconditional clear
   * could unbind a newer editor that has already bound.
   */
  clearSuperDoc: (expectedHost: SuperDocHost) => boolean;
}

const SUPERDOC_UI_KEY: InjectionKey<SuperDocUIBinding> = Symbol('superdoc/ui/vue');

/**
 * Root provider composable. Call it once in an ancestor component's `setup()`.
 * In the editor-mount component, capture the setter during `setup()`
 * (`const setSuperDoc = useSetSuperDoc()`) and call that function from the
 * editor's ready callback to bind a running SuperDoc instance; the composables
 * below then read that instance's own controller (`superdoc.ui`).
 *
 * Capture during `setup()` is required, not stylistic: {@link useSetSuperDoc}
 * resolves the binding through `inject()`, which only sees the provider while
 * a component instance is active. Calling it from the ready callback itself
 * throws the "must be used under" error even with a provider in the tree.
 *
 * The provider is a consumer, not an owner. SuperDoc creates the controller
 * and destroys it in `superdoc.destroy()`, so disposing or rebinding the
 * provider leaves it running for the built-in toolbar and any other consumer
 * of the same instance. Every composable therefore observes the same command
 * state the rest of the application sees.
 *
 * Returns the binding it provided, so the providing component can also read
 * `ui`/`host`, bind from ready, and clear the expected host during teardown
 * without injecting.
 */
export function provideSuperDocUI(): SuperDocUIBinding {
  const ui = shallowRef<BorrowedSuperDocUI | null>(null);
  const host = shallowRef<SuperDocHost | null>(null);
  /** Only ever holds a controller this provider created for a host lacking one. */
  let ownedUi: SuperDocUI | null = null;
  /** Set once the scope is gone, after which no cleanup remains to run. */
  let disposed = false;
  /**
   * Hosts already handed to `clearSuperDoc`. `clearSuperDoc` means "this
   * instance is being torn down", so a setter call that arrives afterwards is
   * a late ready callback from a dead editor, not a rebind. Held weakly: the
   * entry disappears with the instance.
   */
  const retiredHosts = new WeakSet<SuperDocHost>();

  // Destroy a controller this provider built itself. Controllers read off
  // `superdoc.ui` are never passed here: the instance owns those.
  const disposeOwnedUi = (): void => {
    if (!ownedUi) return;
    ownedUi.destroy();
    ownedUi = null;
  };

  const setSuperDoc = (superdoc: SuperDocHost): void => {
    // The setter outlives the scope by design: consumers capture it in
    // `setup()` and call it from the editor's ready callback, so an unmount
    // during a slow document load lands here after `onScopeDispose` has
    // already run. Binding now would publish into refs nothing observes, and
    // for a host without `ui` it would build a fallback controller that no
    // remaining cleanup can destroy, leaking its subscriptions.
    if (disposed) return;

    // Vue proxies values stored in ordinary refs. SuperDoc's `ui` getter uses
    // a private field, which cannot be read with a Proxy as its receiver.
    const rawSuperDoc = toRaw(superdoc);

    // The provider outliving its editors is the supported shape, so `disposed`
    // alone does not cover a torn-down child: a replaced editor whose ready
    // callback lands after its own teardown would bind a dead host over the
    // replacement's live binding, and every composable would then observe the
    // destroyed instance until something rebinds. Teardown already announced
    // this host through `clearSuperDoc`; honour that instead.
    if (retiredHosts.has(rawSuperDoc)) return;

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
    const hostUi = rawSuperDoc.ui;

    disposeOwnedUi();
    if (hostUi) {
      ui.value = hostUi;
    } else {
      const created = createSuperDocUI({ superdoc: rawSuperDoc });
      ownedUi = created;
      ui.value = created;
    }
    host.value = rawSuperDoc;
  };

  const clearSuperDoc = (expectedHost: SuperDocHost): boolean => {
    if (disposed) return false;
    const rawExpected = toRaw(expectedHost);
    // Retire before the early returns. An editor torn down before it ever
    // bound clears nothing and returns `false`, and that is exactly the case
    // whose late ready callback must not bind afterwards.
    retiredHosts.add(rawExpected);
    const currentHost = host.value;
    if (!currentHost) return false;
    // The host is required, not optional, so an unbind can never mean "clear
    // whatever is bound now". Teardown races with rebinding: a component that
    // is being removed reports a stale instance while a replacement may have
    // already bound, and an unconditional clear would unbind the live editor.
    if (currentHost !== rawExpected) return false;

    disposeOwnedUi();
    ui.value = null;
    host.value = null;
    return true;
  };

  onScopeDispose(() => {
    disposed = true;
    disposeOwnedUi();
  });

  const binding: SuperDocUIBinding = { ui, host, setSuperDoc, clearSuperDoc };
  provide(SUPERDOC_UI_KEY, binding);
  return binding;
}

function useBinding(): SuperDocUIBinding {
  const binding = inject(SUPERDOC_UI_KEY, null);
  if (!binding) {
    // Three different mistakes land here, and the third is invisible from the
    // stack trace, so name it: Vue's provide/inject context lives on the module
    // instance, and `superdoc` imports `vue` as an external. An application
    // whose own Vue does not satisfy this package's range can end up resolving
    // a second copy, and then `provide` and `inject` are talking to different
    // Vues while every line of consumer code looks correct.
    throw new Error(
      '[superdoc/ui/vue] composables must be used under a component that called provideSuperDocUI(). ' +
        'Check that an ancestor calls provideSuperDocUI(), that this runs during setup() rather than ' +
        'from a later callback (capture the value in setup() instead), and that the application resolves ' +
        'a single Vue instance shared with superdoc (duplicate Vue copies break provide/inject silently).',
    );
  }
  return binding;
}

/**
 * Read the controller ref; its value is `null` until a SuperDoc instance is
 * bound.
 *
 * Borrowed: the bound instance owns teardown, so the value type omits
 * `destroy()`. A provider-built fallback controller is disposed by the provider.
 */
export function useSuperDocUI(): Readonly<ShallowRef<BorrowedSuperDocUI | null>> {
  return useBinding().ui;
}

/** Read the raw bound SuperDoc host ref; `null` until one is bound. */
export function useSuperDocHost(): Readonly<ShallowRef<SuperDocHost | null>> {
  return useBinding().host;
}

/**
 * Get the stable function used to bind a running SuperDoc instance. Call this
 * from `setup()` and keep the returned function; it stays callable from a
 * later ready callback, whereas this composable itself injects and so only
 * resolves while a component instance is active.
 */
export function useSetSuperDoc(): (superdoc: SuperDocHost) => void {
  return useBinding().setSuperDoc;
}

/**
 * Get the stable function used to unbind an instance during editor teardown,
 * for the case the provider outlives the editor: a `v-if`'d or replaced editor
 * leaves `useSuperDocHost()` reporting a destroyed instance until something
 * rebinds, and if the replacement never becomes ready, indefinitely.
 *
 * Pass the instance being torn down. It is required, so a late teardown
 * returns `false` instead of unbinding a newer instance that already bound.
 * Capture this during `setup()` like {@link useSetSuperDoc}.
 */
export function useClearSuperDoc(): (expectedHost: SuperDocHost) => boolean {
  return useBinding().clearSuperDoc;
}

/**
 * Subscribe to a derived slice of controller state. `pick` selects a value
 * source from the controller: a domain handle / snapshot source
 * ({@link SliceSource}) or a raw `ui.select(...)` {@link Subscribable}, both
 * normalized via {@link toSliceSource}. The returned ref holds `initial` until
 * the controller is bound, and re-subscribes when the controller identity
 * changes. Call from `setup()` (or an active effect scope) so the
 * subscription is released with the scope.
 */
export function useSuperDocSlice<T>(
  pick: (ui: BorrowedSuperDocUI) => SliceSource<T> | Subscribable<T>,
  initial: T,
): Readonly<ShallowRef<T>> {
  const ui = useSuperDocUI();
  const value = shallowRef<T>(initial);

  watch(
    ui,
    (current, _previous, onCleanup) => {
      if (!current) {
        value.value = initial;
        return;
      }
      const source = toSliceSource(pick(current));
      // Seed from the snapshot before subscribing: domain handles' `observe`
      // emits immediately, but command/font-shaped sources notify on change
      // only, and the ref must not sit on `initial` until the first change.
      value.value = source.getSnapshot();
      onCleanup(
        source.observe((next) => {
          value.value = next;
        }),
      );
    },
    { immediate: true },
  );

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
export function useSuperDocSelection(): Readonly<ShallowRef<SelectionSlice>> {
  return useSuperDocSlice((ui) => ui.selection, EMPTY_SELECTION);
}

/** Subscribe to the current Search session. */
export function useSuperDocSearch(): Readonly<ShallowRef<SearchSnapshot>> {
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
export function useSuperDocComments(): Readonly<ShallowRef<CommentsSlice>> {
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
export function useSuperDocContentControls(): Readonly<ShallowRef<ContentControlsSlice>> {
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
export function useSuperDocTrackChanges(): Readonly<ShallowRef<TrackChangesSlice>> {
  return useSuperDocSlice((ui) => ui.trackChanges, {
    status: 'pending',
    items: [],
    total: 0,
    activeId: null,
    authors: [],
  });
}

/** Subscribe to the toolbar snapshot slice. */
export function useSuperDocToolbar(): Readonly<ShallowRef<ToolbarSnapshotSlice>> {
  return useSuperDocSlice((ui) => ui.toolbar, { context: null, commands: {}, copyFormatActive: false });
}

const EMPTY_COMMAND: CommandState = { enabled: false, active: false, supported: false };

/** Reactive state and execution methods for one SuperDoc command. */
export interface UseSuperDocCommandResult {
  /** Complete command state. */
  state: Readonly<ShallowRef<CommandState>>;
  /** Whether the command can run in the current editor state. */
  enabled: Readonly<ComputedRef<boolean>>;
  /** Whether the command is active for the current selection. */
  active: Readonly<ComputedRef<boolean>>;
  /** Whether the bound editor supports the command. */
  supported: Readonly<ComputedRef<boolean>>;
  /** Run the command against the currently bound editor. */
  execute: (payload?: unknown) => CommandExecutionResult;
  /** Run the command and await the routed operation's settled result. */
  executeAsync: (payload?: unknown) => Promise<CommandExecutionResult>;
}

/**
 * Subscribe to and execute a single command. Accepts a plain id, a ref, or a
 * getter; a reactive id re-subscribes and routes execution to the new command.
 */
export function useSuperDocCommand(id: MaybeRefOrGetter<CommandId>): UseSuperDocCommandResult {
  const ui = useSuperDocUI();
  const state = shallowRef<CommandState>(EMPTY_COMMAND);

  watch(
    [ui, () => toValue(id)] as const,
    ([currentUi, currentId], _previous, onCleanup) => {
      if (!currentUi) {
        state.value = EMPTY_COMMAND;
        return;
      }
      const command = currentUi.commands.get(currentId);
      // `CommandHandle.observe` notifies on change only; read the current
      // state first so an already-enabled command renders enabled on mount.
      state.value = command.getState();
      onCleanup(
        command.observe((next) => {
          state.value = next;
        }),
      );
    },
    { immediate: true },
  );

  const execute = (payload?: unknown): CommandExecutionResult => {
    const currentUi = ui.value;
    return currentUi ? currentUi.commands.execute(toValue(id), payload) : false;
  };
  const executeAsync = (payload?: unknown): Promise<CommandExecutionResult> => {
    const currentUi = ui.value;
    return currentUi ? currentUi.commands.executeAsync(toValue(id), payload) : Promise.resolve(false);
  };

  return {
    state,
    enabled: computed(() => state.value.enabled),
    active: computed(() => state.value.active),
    supported: computed(() => state.value.supported),
    execute,
    executeAsync,
  };
}

/** Subscribe to the document slice. */
export function useSuperDocDocument(): Readonly<ShallowRef<DocumentSlice>> {
  return useSuperDocSlice((ui) => ui.document, { ready: false, mode: null, dirty: false });
}

/** Subscribe to available font-family options. */
export function useSuperDocFontOptions(): Readonly<ShallowRef<readonly FontFamilyOption[]>> {
  return useSuperDocSlice(
    (ui) => ({
      getSnapshot: () => ui.fonts.getFamilyOptions(),
      observe: (cb: (value: readonly FontFamilyOption[]) => void) => ui.fonts.observe((slice) => cb(slice.options)),
    }),
    [],
  );
}

/** Subscribe to available font-size options. */
export function useSuperDocFontSizeOptions(): Readonly<ShallowRef<readonly FontSizeOption[]>> {
  return useSuperDocSlice(
    (ui) => ({
      getSnapshot: () => ui.fonts.getSizeOptions(),
      observe: (cb: (value: readonly FontSizeOption[]) => void) => ui.fonts.observe((slice) => cb(slice.sizeOptions)),
    }),
    [],
  );
}

/** Subscribe to the zoom slice. */
export function useSuperDocZoom(): Readonly<ShallowRef<ZoomSlice>> {
  return useSuperDocSlice((ui) => ui.zoom, { mode: null, value: 100, min: 10, max: 100 });
}
