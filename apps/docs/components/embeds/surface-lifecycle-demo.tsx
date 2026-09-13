'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SurfaceHandle, SurfaceOutcome, UIConfig } from 'superdoc';
import type { ZoomSlice } from 'superdoc/ui';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { EDITOR_DEMO_FIT_WIDTH_PADDING, fitRuntimeEditorToWidth } from './editor-demo-zoom';
import { createRuntimeEditor, loadRuntime, type SuperDocInstance } from './superdoc-runtime';

const DEMO_DOCUMENT = '/fixtures/getting-started.docx';
const NARROW_DEMO_WIDTH = 520;
const INITIAL_ZOOM = { max: 200, min: 10, mode: 'manual', value: 80 } satisfies ZoomSlice;

type DemoState = 'idle' | 'loading' | 'ready' | 'error';
type ConfirmationResult = Readonly<{ action: 'continue' }>;

function outcomeMessage(label: string, outcome: SurfaceOutcome<unknown>) {
  switch (outcome.status) {
    case 'submitted':
      return `${label}: submitted.`;
    case 'closed':
      return `${label}: closed.`;
    case 'replaced':
      return `${label}: replaced by ${outcome.replacedBy ?? 'a newer surface'}.`;
    case 'destroyed':
      return `${label}: destroyed with the Editor.`;
  }
}

export function SurfaceLifecycleDemo() {
  const rootRef = useRef<HTMLElement>(null);
  const builtInToolbarRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const dialogRef = useRef<SurfaceHandle<ConfirmationResult> | null>(null);
  const inspectorRef = useRef<SurfaceHandle | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const loadIdRef = useRef(0);
  const mountedRef = useRef(true);
  const zoomRef = useRef<ZoomSlice>(INITIAL_ZOOM);

  const [state, setState] = useState<DemoState>('idle');
  const [message, setMessage] = useState('Open a surface to see how it finishes.');
  const [loadError, setLoadError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  // A collapsed preview clips the Editor canvas, and SurfaceHost sizes the teleported host to
  // the visible intersection — a surface opened then would be clipped out of view.
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(true);
  const ownsFullscreenRef = useRef(false);
  const confirmationButtonRef = useRef<HTMLButtonElement>(null);
  const restoreOpenerFocusRef = useRef(false);
  const readyRef = useRef(false);
  const [zoom, setZoom] = useState<ZoomSlice>(INITIAL_ZOOM);

  const closeOpenSurfaces = useCallback((reason: string) => {
    dialogRef.current?.close(reason);
    inspectorRef.current?.close(reason);
  }, []);

  const teardown = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    dialogRef.current = null;
    inspectorRef.current = null;
    setIsDialogOpen(false);
    instanceRef.current?.destroy();
    instanceRef.current = null;
  }, []);

  const start = useCallback(async () => {
    const loadId = (loadIdRef.current += 1);
    readyRef.current = false;
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
    const toolbarContainer = builtInToolbarRef.current;

    teardown();
    setState('loading');
    setMessage('Loading the document…');
    setLoadError('');
    zoomRef.current = INITIAL_ZOOM;
    setZoom(INITIAL_ZOOM);

    if (!toolbarContainer || !mountRef.current) {
      setState('error');
      setLoadError('The surface example could not be mounted.');
      return;
    }

    try {
      const SuperDocCtor = await loadRuntime();
      if (!isCurrent() || !mountRef.current) return;

      const editorUi = {
        comments: false,
        loading: false,
        toolbar: { container: toolbarContainer, responsiveTo: 'container' },
      } satisfies UIConfig;

      const instance = createRuntimeEditor(SuperDocCtor, {
        selector: mountRef.current,
        document: DEMO_DOCUMENT,
        documentMode: 'editing',
        ui: editorUi,
        zoom: {
          mode: 'manual',
          fitWidth: {
            min: INITIAL_ZOOM.min,
            max: INITIAL_ZOOM.max,
            padding: EDITOR_DEMO_FIT_WIDTH_PADDING,
          },
        },
        onReady: ({ superdoc }) => {
          if (!isCurrent()) return;
          if ((rootRef.current?.clientWidth ?? NARROW_DEMO_WIDTH) < NARROW_DEMO_WIDTH) {
            const fitWhenMeasured = (attempt: number) => {
              if (!isCurrent() || fitRuntimeEditorToWidth(superdoc) || attempt >= 10) return;
              requestAnimationFrame(() => fitWhenMeasured(attempt + 1));
            };
            fitWhenMeasured(0);
          } else {
            superdoc.ui.zoom.set(INITIAL_ZOOM.value);
          }
          readyRef.current = true;
          setState('ready');
          setMessage('Open a surface to see how it finishes.');
        },
        onContentError: () => {
          if (!isCurrent()) return;
          // The callback also covers failures while *updating* a document, so it can arrive
          // after onReady with the reader's edits in the session. Only a failure to open
          // justifies destroying it — the same rule the custom command demo uses.
          if (readyRef.current) {
            setMessage('The Editor could not apply that change. Your edits are still here.');
            return;
          }
          teardown();
          setState('error');
          setLoadError('The sample document could not be read.');
        },
        onException: () => {
          if (isCurrent()) setMessage('The Editor reported a runtime error.');
        },
      });
      instanceRef.current = instance;

      const stopZoom = instance.ui.zoom.observe((snapshot) => {
        zoomRef.current = snapshot;
        if (isCurrent()) setZoom(snapshot);
      });
      cleanupRef.current = stopZoom;

      if (!isCurrent()) teardown();
    } catch (cause) {
      if (!isCurrent()) return;
      teardown();
      setState('error');
      setLoadError(cause instanceof Error ? cause.message : 'The surface example could not start.');
    }
  }, [teardown]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || state !== 'idle') return;

    if (typeof IntersectionObserver === 'undefined') {
      void start();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void start();
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [start, state]);

  useEffect(() => {
    mountedRef.current = true;

    const syncFullscreen = () => {
      const root = rootRef.current;
      const active = document.fullscreenElement === document.documentElement && root?.dataset.fullscreen === 'true';
      ownsFullscreenRef.current = active;
      if (!active && root) delete root.dataset.fullscreen;
      setIsFullscreen(active);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);

    return () => {
      mountedRef.current = false;
      loadIdRef.current += 1;
      document.removeEventListener('fullscreenchange', syncFullscreen);
      if (ownsFullscreenRef.current && document.fullscreenElement === document.documentElement) {
        ownsFullscreenRef.current = false;
        void document.exitFullscreen().catch(() => {});
      }
      teardown();
    };
  }, [teardown]);

  // A promise callback's state update is rendered in a later task, so a microtask queued
  // beside it still sees the disabled opener and its focus() is dropped. Restoring here runs
  // after the commit that re-enables the button.
  useLayoutEffect(() => {
    if (isDialogOpen || !restoreOpenerFocusRef.current) return;
    restoreOpenerFocusRef.current = false;
    confirmationButtonRef.current?.focus();
  }, [isDialogOpen]);

  function observeOutcome<TResult>(
    label: string,
    handle: SurfaceHandle<TResult>,
    activeRef: { current: SurfaceHandle<TResult> | null },
  ) {
    const loadId = loadIdRef.current;
    void handle.result.then((outcome) => {
      if (!mountedRef.current || loadId !== loadIdRef.current) return;
      if (activeRef.current !== handle) {
        setMessage(outcomeMessage(label, outcome));
        return;
      }
      activeRef.current = null;
      if (activeRef === dialogRef) {
        setIsDialogOpen(false);
        // SurfaceDialog restores focus during onBeforeUnmount, while this opener is still
        // disabled, so the restore lands nowhere. Hand the restore to the layout effect below,
        // which runs after React has committed the re-enabled button.
        restoreOpenerFocusRef.current = true;
      }
      setMessage(outcomeMessage(label, outcome));
    });
  }

  function openConfirmation() {
    const instance = instanceRef.current;
    if (!instance) return;

    const handle = instance.openSurface<ConfirmationResult>({
      mode: 'dialog',
      title: 'Continue editing?',
      render: ({ container, close, resolve }) => {
        const description = document.createElement('p');
        description.className = 'sd-surface-lifecycle-demo-surface-description';
        description.textContent = 'Choose Continue to submit this dialog, or close it without submitting.';

        const actions = document.createElement('div');
        actions.className = 'sd-surface-lifecycle-demo-surface-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';

        const continueButton = document.createElement('button');
        continueButton.type = 'button';
        continueButton.className = 'sd-surface-lifecycle-demo-primary';
        continueButton.textContent = 'Continue';

        const cancelDialog = () => close('cancel');
        const submitDialog = () => resolve({ action: 'continue' });
        cancel.addEventListener('click', cancelDialog);
        continueButton.addEventListener('click', submitDialog);
        actions.append(cancel, continueButton);
        container.append(description, actions);

        return {
          destroy() {
            cancel.removeEventListener('click', cancelDialog);
            continueButton.removeEventListener('click', submitDialog);
          },
        };
      },
    });

    // A built-in toolbar dropdown teleports its menu to <body>, above the surface host and
    // outside the inert toolbar mount, so it would stay interactive over this modal. Dismissing
    // it *after* openSurface() is what keeps the inspector: the manager assigns activeDialog
    // synchronously, and SurfaceHost's floating Escape handler defers once a dialog is open.
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));

    dialogRef.current = handle;
    setIsDialogOpen(true);
    setMessage('Confirmation opened. Continue submits; Cancel, Escape, or the backdrop closes.');
    observeOutcome('Confirmation', handle, dialogRef);
  }

  function openInspector() {
    const instance = instanceRef.current;
    if (!instance) return;

    const handle = instance.openSurface({
      mode: 'floating',
      title: 'Document inspector',
      floating: { maxWidth: 280 },
      render: ({ container, close }) => {
        const description = document.createElement('p');
        description.className = 'sd-surface-lifecycle-demo-surface-description';
        description.textContent = 'Keep selecting and editing document text while this panel stays open.';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'sd-surface-lifecycle-demo-surface-button';
        closeButton.textContent = 'Close inspector';

        const closeInspector = () => close('button');
        closeButton.addEventListener('click', closeInspector);
        container.append(description, closeButton);

        return {
          destroy() {
            closeButton.removeEventListener('click', closeInspector);
          },
        };
      },
    });

    inspectorRef.current = handle;
    setMessage('Inspector opened. Open it again to replace this instance.');
    observeOutcome('Inspector', handle, inspectorRef);
  }

  function changeZoom(direction: -1 | 1) {
    const currentZoom = zoomRef.current;
    const nextZoom = Math.min(currentZoom.max, Math.max(currentZoom.min, currentZoom.value + direction * 10));
    instanceRef.current?.ui.zoom.set(nextZoom);
  }

  function fitToWidth() {
    if (instanceRef.current) fitRuntimeEditorToWidth(instanceRef.current);
  }

  async function toggleFullscreen() {
    const root = rootRef.current;
    if (!root) return;

    if (document.fullscreenElement === document.documentElement && root.dataset.fullscreen === 'true') {
      await document.exitFullscreen();
      return;
    }

    root.dataset.fullscreen = 'true';
    try {
      await document.documentElement.requestFullscreen();
      // The request can settle after an unmount, which has already run the only cleanup.
      // Hand fullscreen back rather than recording ownership nobody will release.
      if (!mountedRef.current) {
        void document.exitFullscreen().catch(() => {});
        return;
      }
      ownsFullscreenRef.current = true;
    } catch {
      ownsFullscreenRef.current = false;
      delete root.dataset.fullscreen;
      setMessage('Fullscreen could not start in this browser.');
    }
  }

  function collapseDemo() {
    closeOpenSurfaces('collapsed');
    mountRef.current?.scrollTo({ top: 0 });
  }

  const controlsReady = state === 'ready';

  return (
    <figure
      className='sd-custom-bold-demo sd-surface-lifecycle-demo'
      data-state={state}
      data-surface-lifecycle-demo
      ref={rootRef}
    >
      <CollapsibleEditorPreview
        className='sd-surface-lifecycle-demo-preview'
        contentClassName='sd-surface-lifecycle-demo-workspace'
        defaultExpanded
        expandedMaxHeight='72rem'
        onCollapse={collapseDemo}
        onExpandedChange={setIsPreviewExpanded}
        toggleDisabled={isDialogOpen}
      >
        <div className='sd-custom-bold-demo-built-in'>
          <div className='sd-surface-lifecycle-demo-built-in-header'>
            <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
              SuperDoc UI
            </span>
            <EditorDemoViewControls
              disabled={!controlsReady || isDialogOpen || !isPreviewExpanded}
              fitActive={zoom.mode === 'fit-width'}
              isFullscreen={isFullscreen}
              onFit={fitToWidth}
              onFullscreen={() => void toggleFullscreen()}
              onZoom={changeZoom}
              zoom={zoom}
            />
          </div>
          {/*
            The dialog's focus trap only sees keydowns bubbling through its own backdrop, so
            anything focusable outside it can take focus and strand Tab and Escape. Everything
            beside the modal goes inert while it is open, not just the surface buttons.
          */}
          <div className='sd-custom-bold-demo-built-in-toolbar' inert={isDialogOpen} ref={builtInToolbarRef} />
        </div>

        <div className='sd-surface-lifecycle-demo-controls' role='group' aria-label='Application surfaces'>
          <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
            Your application
          </span>
          <button
            disabled={!controlsReady || !isPreviewExpanded || isDialogOpen}
            onClick={openConfirmation}
            ref={confirmationButtonRef}
            type='button'
          >
            Open confirmation
          </button>
          <button
            disabled={!controlsReady || isDialogOpen || !isPreviewExpanded}
            onClick={openInspector}
            title={
              isDialogOpen ? 'Close the confirmation dialog first: a modal owns focus while it is open.' : undefined
            }
            type='button'
          >
            Open inspector
          </button>
          <output aria-live='polite'>{message}</output>
        </div>

        {loadError ? (
          <div className='sd-custom-bold-demo-error' role='alert'>
            <p>{loadError}</p>
            <button onClick={() => void start()} type='button'>
              Try again
            </button>
          </div>
        ) : null}
        <div className='sd-custom-bold-demo-canvas sd-surface-lifecycle-demo-canvas' ref={mountRef} />
      </CollapsibleEditorPreview>
    </figure>
  );
}
