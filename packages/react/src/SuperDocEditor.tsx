import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ForwardedRef,
} from 'react';
import { useStableId, useMemoByContent, useMemoByValue } from './utils';
import type {
  CallbackProps,
  DocumentMode,
  SuperDocEditorProps,
  SuperDocConfig,
  SuperDocInstance,
  SuperDocRef,
  SuperDocReadyEvent,
  SuperDocEditorCreateEvent,
  SuperDocEditorUpdateEvent,
  SuperDocTransactionEvent,
  SuperDocContentErrorEvent,
  SuperDocExceptionEvent,
  SuperDocZoomChangeEvent,
  SuperDocViewportChangeEvent,
  SuperDocPageMarginsChangeEvent,
} from './types';

/**
 * SuperDocEditor - React wrapper component for SuperDoc
 *
 * Provides a component-based API with proper lifecycle management
 * and React Strict Mode compatibility. Container divs are always
 * rendered (hidden until initialized) so SuperDoc can mount into
 * them on the first client-side effect.
 */
function SuperDocEditorInner(props: SuperDocEditorProps, ref: ForwardedRef<SuperDocRef>) {
  const [hasError, setHasError] = useState(false);

  // Destructure React-specific props and key rebuild triggers
  const {
    // React-specific
    id,
    renderLoading,
    hideToolbar = false,
    contained = false,
    className,
    style,
    // Callbacks (stored in ref to avoid triggering rebuilds)
    onReady,
    onEditorCreate,
    onEditorDestroy,
    onEditorUpdate,
    onTransaction,
    onContentError,
    onException,
    onZoomChange,
    onViewportChange,
    onPageMarginsChange,
    // Key props that trigger rebuild when changed
    document: documentProp,
    user: userProp,
    users: usersProp,
    modules,
    ui: uiProp,
    // All other props passed through
    ...restProps
  } = props;

  const ui = useMemoByContent(uiProp);

  // Apply defaults
  const documentMode = props.documentMode ?? 'editing';
  const role = props.role ?? 'editor';

  // Whether to render the built-in toolbar container.
  //
  // React has to answer this locally because it owns the DOM element the
  // toolbar mounts into, but the answer comes from the core config rather
  // than a React-only flag: `ui: false` and `ui.toolbar: false` both mean no
  // toolbar, and honoring them here keeps React from holding a second,
  // conflicting opinion. `hideToolbar` is the older spelling and still wins
  // when set, so existing components behave exactly as before.
  const uiToolbar = ui === false ? false : ui?.toolbar;
  // A consumer who named their own container gets the toolbar there, so an
  // internal host would sit empty in the layout — and its id would still be
  // handed to core as a mount target below.
  const consumerOwnsToolbarContainer =
    typeof uiToolbar === 'object' && uiToolbar !== null && uiToolbar.container !== undefined;
  const rendersToolbar = !hideToolbar && uiToolbar !== false && !consumerOwnsToolbarContainer;

  // What actually reaches the core config. `hideToolbar` is the older, blunter
  // spelling and wins outright, so a consumer's `ui.toolbar` has to be replaced
  // rather than merely withheld from React's own container: an external
  // `ui.toolbar.container` would otherwise still mount a toolbar the prop said
  // to hide.
  const resolvedUi: SuperDocEditorProps['ui'] = (() => {
    if (ui === false || ui === undefined) return ui;
    if (!hideToolbar) return ui;
    const { toolbar: _hidden, ...rest } = ui;
    return { ...rest, toolbar: false };
  })();

  // `user` and `users` are memoized by value so inline literals don't
  // trigger a rebuild. `modules` stays on reference identity — it can
  // carry functions and live objects (e.g. `collaboration.provider`)
  // that a consumer may intentionally swap. See SD-2635.
  const user = useMemoByValue(userProp);
  const users = useMemoByValue(usersProp);
  const userRef = useRef(user);
  userRef.current = user;

  const instanceRef = useRef<SuperDocInstance | null>(null);
  const toolbarContainerRef = useRef<HTMLDivElement | null>(null);

  // Generate stable IDs (useStableId returns the same value across re-renders)
  const generatedId = useStableId();
  const baseId = id ?? `superdoc${generatedId}`;
  const containerId = baseId;
  const toolbarId = `${baseId}-toolbar`;

  const [isLoading, setIsLoading] = useState(true);

  // Store callbacks in refs to avoid triggering effect on callback changes
  const callbacksRef = useRef<CallbackProps>({
    onReady,
    onEditorCreate,
    onEditorDestroy,
    onEditorUpdate,
    onTransaction,
    onContentError,
    onException,
    onZoomChange,
    onViewportChange,
    onPageMarginsChange,
  });

  // Update callback refs when props change
  useEffect(() => {
    callbacksRef.current = {
      onReady,
      onEditorCreate,
      onEditorDestroy,
      onEditorUpdate,
      onTransaction,
      onContentError,
      onException,
      onZoomChange,
      onViewportChange,
      onPageMarginsChange,
    };
  }, [
    onReady,
    onEditorCreate,
    onEditorDestroy,
    onEditorUpdate,
    onTransaction,
    onContentError,
    onException,
    onZoomChange,
    onViewportChange,
    onPageMarginsChange,
  ]);

  // Queue mode changes that happen during init
  const pendingModeRef = useRef<DocumentMode | null>(null);
  const isInitializingRef = useRef(false);

  // Track documentMode changes and apply imperatively
  const prevDocumentModeRef = useRef(documentMode);
  useEffect(() => {
    if (prevDocumentModeRef.current !== documentMode) {
      if (instanceRef.current) {
        // Instance exists, apply immediately
        instanceRef.current.setDocumentMode(documentMode);
      } else if (isInitializingRef.current) {
        // Instance is initializing, queue the mode change
        pendingModeRef.current = documentMode;
      }
    }
    prevDocumentModeRef.current = documentMode;
  }, [documentMode]);

  const appliedUserRef = useRef(user);
  const applyUser = useCallback((instance: SuperDocInstance) => {
    const next = userRef.current;
    if (appliedUserRef.current === next || !next) return;
    appliedUserRef.current = next;
    instance.setUser(next).catch((error: unknown) => {
      callbacksRef.current.onException?.({ error: error as Error });
    });
  }, []);
  useEffect(() => {
    if (instanceRef.current && !isInitializingRef.current) applyUser(instanceRef.current);
  }, [user, applyUser]);

  // Expose ref methods - simplified API with just getInstance()
  useImperativeHandle(
    ref,
    () => ({
      getInstance: () => instanceRef.current,
    }),
    [],
  );

  // Main effect: create and destroy SuperDoc instance
  useEffect(() => {
    // Reset states when document changes
    setIsLoading(true);
    setHasError(false);
    isInitializingRef.current = true;

    let destroyed = false;
    let instance: SuperDocInstance | null = null;

    const initSuperDoc = async () => {
      try {
        // Dynamic import for SSR safety
        const superdocModule = await import('superdoc');
        const SuperDoc = superdocModule.SuperDoc as new (config: SuperDocConfig) => SuperDocInstance;

        // Check if we were destroyed while loading
        if (destroyed) return;

        // Build configuration - pass through all props
        const superdocConfig = {
          ...restProps,
          selector: `#${CSS.escape(containerId)}`,
          // Mount into the internal toolbar container when one is rendered.
          // This is the top-level alias, which the core resolves *after*
          // `ui.toolbar.container` — so a consumer's own container still wins.
          // The two are different keys, so spread order here is not what
          // decides it.
          ...(rendersToolbar && toolbarContainerRef.current ? { toolbar: `#${CSS.escape(toolbarId)}` } : {}),
          documentMode,
          role,
          contained,
          ...(documentProp != null ? { document: documentProp } : {}),
          ...(userRef.current ? { user: userRef.current } : {}),
          ...(users ? { users } : {}),
          ...(modules ? { modules } : {}),
          ...(resolvedUi !== undefined ? { ui: resolvedUi } : {}),
          // Wire up callbacks with lifecycle guards
          onReady: (event: SuperDocReadyEvent) => {
            if (!destroyed) {
              setIsLoading(false);
              isInitializingRef.current = false;

              // Apply any pending mode changes
              if (pendingModeRef.current && pendingModeRef.current !== documentMode) {
                event.superdoc.setDocumentMode(pendingModeRef.current);
                pendingModeRef.current = null;
              }
              applyUser(event.superdoc);

              callbacksRef.current.onReady?.(event);
            }
          },
          onEditorCreate: (event: SuperDocEditorCreateEvent) => {
            if (!destroyed) {
              callbacksRef.current.onEditorCreate?.(event);
            }
          },
          onEditorDestroy: () => {
            if (!destroyed) {
              callbacksRef.current.onEditorDestroy?.();
            }
          },
          onEditorUpdate: (event: SuperDocEditorUpdateEvent) => {
            if (!destroyed) {
              callbacksRef.current.onEditorUpdate?.(event);
            }
          },
          onTransaction: (event: SuperDocTransactionEvent) => {
            if (!destroyed) {
              callbacksRef.current.onTransaction?.(event);
            }
          },
          onContentError: (event: SuperDocContentErrorEvent) => {
            if (!destroyed) {
              callbacksRef.current.onContentError?.(event);
            }
          },
          onException: (event: SuperDocExceptionEvent) => {
            if (!destroyed) {
              callbacksRef.current.onException?.(event);
            }
          },
          onZoomChange: (event: SuperDocZoomChangeEvent) => {
            if (!destroyed) {
              callbacksRef.current.onZoomChange?.(event);
            }
          },
          onViewportChange: (event: SuperDocViewportChangeEvent) => {
            if (!destroyed) {
              callbacksRef.current.onViewportChange?.(event);
            }
          },
          onPageMarginsChange: (event: SuperDocPageMarginsChangeEvent) => {
            if (!destroyed) {
              callbacksRef.current.onPageMarginsChange?.(event);
            }
          },
        };

        appliedUserRef.current = userRef.current;
        instance = new SuperDoc(superdocConfig) as SuperDocInstance;
        instanceRef.current = instance;
      } catch (error) {
        if (!destroyed) {
          isInitializingRef.current = false;
          setIsLoading(false);
          setHasError(true);
          console.error('[SuperDocEditor] Failed to initialize SuperDoc:', error);
          callbacksRef.current.onException?.({ error: error as Error });
        }
      }
    };

    initSuperDoc();

    // Cleanup function
    return () => {
      isInitializingRef.current = false;
      pendingModeRef.current = null;
      if (instance) {
        instance.destroy();
        instanceRef.current = null;
      }
      destroyed = true;
    };
    // Only these props trigger a full rebuild. Other props (rulers, etc.) are
    // initial values — use getInstance() methods to change them at runtime.
    // restProps is intentionally excluded to avoid rebuilds on every render.
    // documentMode is handled separately via setDocumentMode() for efficiency.
  }, [documentProp, users, modules, ui, role, hideToolbar, contained, containerId, toolbarId]);

  const wrapperClassName = ['superdoc-wrapper', className].filter(Boolean).join(' ');
  const builtInLoadingEnabled = ui !== false && ui?.loading !== false;
  const hideToolbarWhenLoading: CSSProperties | undefined = isLoading ? { display: 'none' } : undefined;
  const hideEditorWhenLoading: CSSProperties | undefined =
    isLoading && (renderLoading || !builtInLoadingEnabled) ? { display: 'none' } : undefined;

  const wrapperStyle: CSSProperties = {
    ...style,
    ...(contained && { display: 'flex', flexDirection: 'column' as const }),
  };

  return (
    <div className={wrapperClassName} style={wrapperStyle}>
      {rendersToolbar && (
        <div
          ref={toolbarContainerRef}
          id={toolbarId}
          className='superdoc-toolbar-container'
          style={hideToolbarWhenLoading}
        />
      )}
      <div
        id={containerId}
        className='superdoc-editor-container'
        style={{ ...hideEditorWhenLoading, ...(contained && { flex: 1, minHeight: 0 }) }}
      />
      {isLoading && !hasError && renderLoading && <div className='superdoc-loading-container'>{renderLoading()}</div>}
      {hasError && <div className='superdoc-error-container'>Failed to load editor. Check console for details.</div>}
    </div>
  );
}

/**
 * SuperDocEditor component with forwardRef - Initializes SuperDoc instance and handles cleanup.
 */
export const SuperDocEditor = forwardRef<SuperDocRef, SuperDocEditorProps>(SuperDocEditorInner);

SuperDocEditor.displayName = 'SuperDocEditor';

export default SuperDocEditor;
