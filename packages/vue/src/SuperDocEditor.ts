import { defineComponent, h, nextTick, onBeforeUnmount, onMounted, shallowRef, toRaw, watch } from 'vue';
import type {
  ComponentOptionsMixin,
  DefineComponent,
  EmitsToProps,
  PropType,
  PublicProps,
  SlotsType,
  VNode,
} from 'vue';

import type {
  DocumentMode,
  SuperDocConfig,
  SuperDocContentErrorEvent,
  SuperDocEditorConfig,
  SuperDocEditorExpose,
  SuperDocEditorUIBinding,
  SuperDocEditorCreateEvent,
  SuperDocEditorUpdateEvent,
  SuperDocExceptionEvent,
  SuperDocInstance,
  SuperDocModules,
  SuperDocReadyEvent,
  SuperDocTransactionEvent,
  SuperDocUIConfig,
  SuperDocUser,
  SuperDocViewportChangeEvent,
  SuperDocZoomChangeEvent,
  UserRole,
} from './types';

interface SuperDocEditorProps {
  document?: SuperDocConfig['document'] | null;
  documentMode?: DocumentMode;
  role?: UserRole;
  user?: SuperDocUser;
  users?: SuperDocConfig['users'];
  modules?: SuperDocModules;
  ui?: SuperDocUIConfig;
  uiBinding?: SuperDocEditorUIBinding;
  contained?: boolean;
  config?: SuperDocEditorConfig;
}

type SuperDocEditorEmits = {
  ready: (event: SuperDocReadyEvent) => boolean;
  'editor-create': (event: SuperDocEditorCreateEvent) => boolean;
  'editor-destroy': () => boolean;
  'editor-update': (event: SuperDocEditorUpdateEvent) => boolean;
  transaction: (event: SuperDocTransactionEvent) => boolean;
  'content-error': (event: SuperDocContentErrorEvent) => boolean;
  exception: (event: SuperDocExceptionEvent) => boolean;
  /** @deprecated replaceWith=`superdoc.ui.zoom.observe` removeIn=v3.0 */
  'zoom-change': (event: SuperDocZoomChangeEvent) => boolean;
  'viewport-change': (event: SuperDocViewportChangeEvent) => boolean;
  'update:documentMode': (mode: DocumentMode) => boolean;
};

type SuperDocEditorSlots = SlotsType<{
  loading: Record<string, never>;
  error: { error: unknown };
}>;

type SuperDocEditorComponent = DefineComponent<
  SuperDocEditorProps,
  SuperDocEditorExpose,
  {},
  {},
  {},
  ComponentOptionsMixin,
  ComponentOptionsMixin,
  SuperDocEditorEmits,
  keyof SuperDocEditorEmits,
  PublicProps,
  Readonly<SuperDocEditorProps> & EmitsToProps<SuperDocEditorEmits>,
  {},
  SuperDocEditorSlots,
  {},
  {},
  'getInstance'
>;

function raw<T>(value: T): T {
  return value === null || typeof value !== 'object' ? value : toRaw(value);
}

/**
 * Reads nested fields so Vue tracks in-place changes, while equal plain values
 * share a key. Callers compare non-serializable values by reference.
 */
function valueKey(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? 'undefined';
  } catch {
    return null;
  }
}

/**
 * Always renders stable mount elements for SuperDoc and SSR hydration. Uses
 * `defineComponent` instead of an SFC so the package does not need the SFC
 * compiler.
 */
const SuperDocEditorImplementation = defineComponent({
  name: 'SuperDocEditor',
  props: {
    /** URL, File, or Blob to open. Changing it rebuilds the editor. */
    // `null` lets a file picker start empty; the wrapper omits it from core.
    document: { type: [String, Object] as PropType<SuperDocConfig['document'] | null>, default: undefined },
    /** Editing mode. Supports `v-model:document-mode` without rebuilding. */
    documentMode: { type: String as PropType<DocumentMode>, default: 'editing' },
    /** Permission role. Changing it rebuilds the editor. */
    role: { type: String as PropType<UserRole>, default: 'editor' },
    /** Current user. Compared by value. */
    user: { type: Object as PropType<SuperDocUser>, default: undefined },
    /** All users. Compared by value. */
    users: { type: Array as PropType<SuperDocConfig['users']>, default: undefined },
    /**
     * Module config. Compared by reference because it can contain live
     * collaboration objects. Replace the object to rebuild.
     */
    modules: { type: Object as PropType<SuperDocModules>, default: undefined },
    /** Built-in UI config. Compared by reference; changing it rebuilds. */
    ui: { type: [Object, Boolean] as PropType<SuperDocUIConfig>, default: undefined },
    /** Custom-UI binding returned by `provideSuperDocUI()`. Managed in place. */
    uiBinding: { type: Object as PropType<SuperDocEditorUIBinding>, default: undefined },
    /** Fit and scroll inside a fixed-height parent. */
    contained: { type: Boolean, default: false },
    /**
     * Other core options. Read at startup; later changes log a warning and are
     * ignored.
     */
    config: { type: Object as PropType<SuperDocEditorConfig>, default: undefined },
  },
  emits: {
    ready: (_event: SuperDocReadyEvent) => true,
    'editor-create': (_event: SuperDocEditorCreateEvent) => true,
    'editor-destroy': () => true,
    'editor-update': (_event: SuperDocEditorUpdateEvent) => true,
    transaction: (_event: SuperDocTransactionEvent) => true,
    'content-error': (_event: SuperDocContentErrorEvent) => true,
    exception: (_event: SuperDocExceptionEvent) => true,
    'zoom-change': (_event: SuperDocZoomChangeEvent) => true,
    'viewport-change': (_event: SuperDocViewportChangeEvent) => true,
    'update:documentMode': (_mode: DocumentMode) => true,
  },
  slots: Object as SlotsType<{
    loading: Record<string, never>;
    error: { error: unknown };
  }>,
  setup(props, { emit, expose, slots }) {
    const editorEl = shallowRef<HTMLDivElement | null>(null);
    const toolbarEl = shallowRef<HTMLDivElement | null>(null);
    const isLoading = shallowRef(true);
    const hasError = shallowRef(false);
    const bootError = shallowRef<unknown>(null);

    let instance: SuperDocInstance | null = null;
    /** Invalidates stale async setup after a rebuild or unmount. */
    let generation = 0;
    let isInitializing = false;
    /** Mode requested during setup; applied on ready. */
    let pendingMode: DocumentMode | null = null;
    /** Last applied mode, used to stop v-model echo loops. */
    let appliedMode: DocumentMode | null = null;
    /** Stops wrapper teardown from emitting a second destroy event. */
    let coreEmittedDestroy = false;
    /** Binding currently publishing this component's ready instance. */
    let boundUiBinding: SuperDocEditorUIBinding | null = null;

    // Render a toolbar host unless it is disabled or the consumer supplies one.
    const rendersToolbar = (): boolean => {
      const ui = props.ui;
      const uiToolbar = ui === false ? false : ui?.toolbar;
      const consumerOwnsContainer =
        typeof uiToolbar === 'object' && uiToolbar !== null && uiToolbar.container !== undefined;
      return uiToolbar !== false && !consumerOwnsContainer;
    };

    const replaceUiBinding = (current: SuperDocInstance, next: SuperDocEditorUIBinding | null): void => {
      if (boundUiBinding === next) return;
      boundUiBinding?.clearSuperDoc(current);
      boundUiBinding = next;
      boundUiBinding?.setSuperDoc(current);
    };

    const destroyInstance = (): void => {
      const current = instance;
      instance = null;
      coreEmittedDestroy = false;
      if (current) replaceUiBinding(current, null);
      try {
        // Keep the generation valid while core may emit `onEditorDestroy`.
        current?.destroy();
      } catch (error) {
        // Collaboration providers can throw during cleanup. Keep rebuilding so
        // one failed disconnect cannot leave stale callbacks active.
        console.error('[SuperDocEditor] Failed to destroy SuperDoc:', error);
      } finally {
        // Core does not currently call `onEditorDestroy`. Emit for wrapper-owned
        // teardown, but avoid a duplicate if core starts calling it.
        if (current && !coreEmittedDestroy) emit('editor-destroy');
        generation += 1;
        isInitializing = false;
        pendingMode = null;
      }
    };

    const init = async (): Promise<void> => {
      const gen = ++generation;
      isLoading.value = true;
      hasError.value = false;
      bootError.value = null;
      isInitializing = true;

      try {
        // Core reads browser globals at module scope, so load it after mount.
        const superdocModule = await import('superdoc');
        await nextTick();
        if (gen !== generation) return;

        const editorHost = editorEl.value;
        if (!editorHost) return;

        const mode = props.documentMode;
        const config = {
          ...(props.config ? raw(props.config) : {}),
          selector: editorHost,
          ...(rendersToolbar() && toolbarEl.value ? { toolbar: toolbarEl.value } : {}),
          documentMode: mode,
          role: props.role,
          contained: props.contained,
          ...(props.document != null ? { document: raw(props.document) } : {}),
          ...(props.user ? { user: raw(props.user) } : {}),
          ...(props.users ? { users: raw(props.users) } : {}),
          ...(props.modules ? { modules: raw(props.modules) } : {}),
          ...(props.ui !== undefined ? { ui: raw(props.ui) } : {}),
          onReady: (event: { superdoc: SuperDocInstance }) => {
            if (gen !== generation) return;
            isLoading.value = false;
            isInitializing = false;
            replaceUiBinding(event.superdoc, props.uiBinding ? raw(props.uiBinding) : null);
            if (pendingMode && pendingMode !== mode) {
              // Assign before calling: the mode-change event fires synchronously and must not echo into v-model.
              appliedMode = pendingMode;
              event.superdoc.setDocumentMode(appliedMode);
            }
            pendingMode = null;
            emit('ready', event);
          },
          onEditorCreate: (event) => {
            if (gen === generation) emit('editor-create', event);
          },
          onEditorDestroy: () => {
            if (gen !== generation) return;
            if (instance) replaceUiBinding(instance, null);
            coreEmittedDestroy = true;
            emit('editor-destroy');
          },
          onEditorUpdate: (event) => {
            if (gen === generation) emit('editor-update', event);
          },
          onTransaction: (event) => {
            if (gen === generation) emit('transaction', event);
          },
          onContentError: (event) => {
            if (gen === generation) emit('content-error', event);
          },
          onException: (event) => {
            if (gen === generation) emit('exception', event);
          },
          onZoomChange: (event) => {
            if (gen === generation) emit('zoom-change', event);
          },
          onViewportChange: (event) => {
            if (gen === generation) emit('viewport-change', event);
          },
        } as SuperDocConfig;

        const created = new superdocModule.SuperDoc(config) as SuperDocInstance;
        if (gen !== generation) {
          created.destroy();
          return;
        }
        instance = created;
        appliedMode = mode;

        // Feed external mode changes into v-model without echoing prop changes.
        created.on?.('document-mode-change', (event: { documentMode?: DocumentMode }) => {
          if (gen !== generation) return;
          const next = event?.documentMode;
          if (!next || next === appliedMode) return;
          appliedMode = next;
          emit('update:documentMode', next);
        });
      } catch (error) {
        if (gen !== generation) return;
        isInitializing = false;
        isLoading.value = false;
        hasError.value = true;
        bootError.value = error;
        console.error('[SuperDocEditor] Failed to initialize SuperDoc:', error);
      }
    };

    const rebuild = (): void => {
      destroyInstance();
      void init();
    };

    onMounted(() => void init());
    onBeforeUnmount(destroyInstance);

    // Plain user data is compared by value. Modules and UI can contain live
    // objects, so their identity controls rebuilds.
    watch(
      () =>
        [
          props.document,
          props.modules,
          props.ui,
          props.role,
          props.contained,
          props.user,
          props.users,
          valueKey(props.user),
          valueKey(props.users),
        ] as const,
      (next, previous) => {
        const [, , , , , nextUser, nextUsers, nextUserKey, nextUsersKey] = next;
        const [, , , , , previousUser, previousUsers, previousUserKey, previousUsersKey] = previous;
        const byReferenceChanged = next
          .slice(0, 5)
          .some((value, index) => !Object.is(value, (previous as readonly unknown[])[index]));
        // Fall back to identity when a value cannot be serialized.
        const changedByValue = (
          nextKey: string | null,
          previousKey: string | null,
          nextValue: unknown,
          previousValue: unknown,
        ): boolean =>
          nextKey === null || previousKey === null ? !Object.is(nextValue, previousValue) : nextKey !== previousKey;
        if (
          byReferenceChanged ||
          changedByValue(nextUserKey, previousUserKey, nextUser, previousUser) ||
          changedByValue(nextUsersKey, previousUsersKey, nextUsers, previousUsers)
        ) {
          rebuild();
        }
      },
    );

    // Apply mode changes in place, or queue them until ready.
    watch(
      () => props.documentMode,
      (mode) => {
        if (mode === appliedMode) {
          // A pre-ready `editing → viewing → editing` sequence must clear
          // the queued `viewing` mode.
          pendingMode = null;
          return;
        }
        if (instance && !isInitializing) {
          // Assign before calling: the mode-change event fires synchronously
          // and must not echo into v-model.
          appliedMode = mode;
          instance.setDocumentMode(mode);
        } else if (isInitializing) {
          // Core rejects `setDocumentMode` until ready.
          pendingMode = mode;
        }
      },
    );

    watch(
      () => props.uiBinding,
      (binding) => {
        if (!instance || isInitializing) return;
        replaceUiBinding(instance, binding ? raw(binding) : null);
      },
    );

    // Read nested config fields so in-place changes still trigger the warning.
    watch(
      () => [props.config, valueKey(props.config)] as const,
      () => {
        if (!instance && !isInitializing) return;
        console.warn(
          '[SuperDocEditor] `config` is applied when the instance is created; this change is ignored. ' +
            'Use getInstance() or a managed prop (document, documentMode, user, users, modules, ui, role, contained) for runtime changes.',
        );
      },
    );

    expose({
      // Keep the internal instance for teardown, but expose it only after ready.
      getInstance: () => (isInitializing ? null : instance),
    });

    return (): VNode => {
      const hideWhenLoading = isLoading.value ? { display: 'none' } : undefined;
      return h(
        'div',
        {
          class: 'superdoc-wrapper',
          // Resolve the fixed parent height so the flexing editor scrolls
          // instead of expanding the page in contained mode.
          style: props.contained ? { display: 'flex', flexDirection: 'column', height: '100%' } : undefined,
        },
        [
          rendersToolbar()
            ? h('div', { ref: toolbarEl, class: 'superdoc-toolbar-container', style: hideWhenLoading })
            : null,
          h('div', {
            ref: editorEl,
            class: 'superdoc-editor-container',
            style: {
              ...hideWhenLoading,
              ...(props.contained ? { flex: '1 1 0%', minHeight: '0' } : {}),
            },
          }),
          isLoading.value && !hasError.value && slots.loading
            ? h('div', { class: 'superdoc-loading-container' }, slots.loading({}))
            : null,
          hasError.value
            ? h(
                'div',
                { class: 'superdoc-error-container' },
                slots.error
                  ? slots.error({ error: bootError.value })
                  : 'Failed to load editor. Check console for details.',
              )
            : null,
        ],
      );
    };
  },
});

export const SuperDocEditor = SuperDocEditorImplementation as unknown as SuperDocEditorComponent;

export default SuperDocEditor;
