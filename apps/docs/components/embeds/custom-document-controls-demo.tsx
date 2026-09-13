'use client';

import { Download, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIConfig } from 'superdoc';
import type { BorrowedSuperDocUI, DocumentSlice, ZoomSlice } from 'superdoc/ui';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EDITOR_DEMO_FIT_WIDTH_PADDING, fitRuntimeEditorToWidth } from './editor-demo-zoom';
import { createRuntimeEditor, loadRuntime, type SuperDocInstance } from './superdoc-runtime';

const DEMO_DOCUMENT = '/fixtures/getting-started.docx';
const ZOOM_STEP = 10;
const INITIAL_ZOOM = { max: 200, min: 10, mode: null, value: 100 } satisfies ZoomSlice;
const INITIAL_DOCUMENT = { dirty: false, mode: null, ready: false } satisfies DocumentSlice;

type DemoState = 'idle' | 'loading' | 'ready' | 'error';

function modeLabel(mode: DocumentSlice['mode']) {
  if (mode === 'editing') return 'Editing';
  if (mode === 'suggesting') return 'Suggesting';
  if (mode === 'viewing') return 'Viewing';
  return 'Ready';
}

export function CustomDocumentControlsDemo() {
  const rootRef = useRef<HTMLElement>(null);
  const builtInToolbarRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const uiRef = useRef<BorrowedSuperDocUI | null>(null);
  const observerCleanupRef = useRef<(() => void) | null>(null);
  const exportInFlightRef = useRef(false);
  const loadIdRef = useRef(0);
  const readyRef = useRef(false);
  const mountedRef = useRef(true);

  const [state, setState] = useState<DemoState>('idle');
  const [zoom, setZoom] = useState<ZoomSlice>(INITIAL_ZOOM);
  const [documentState, setDocumentState] = useState<DocumentSlice>(INITIAL_DOCUMENT);
  const [isExporting, setIsExporting] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [runtimeError, setRuntimeError] = useState('');
  const [loadError, setLoadError] = useState('');

  const teardown = useCallback(() => {
    observerCleanupRef.current?.();
    observerCleanupRef.current = null;
    uiRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
    exportInFlightRef.current = false;
  }, []);

  const start = useCallback(async () => {
    const loadId = (loadIdRef.current += 1);
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
    const toolbarContainer = builtInToolbarRef.current;

    teardown();
    readyRef.current = false;
    setState('loading');
    setZoom(INITIAL_ZOOM);
    setDocumentState(INITIAL_DOCUMENT);
    setIsExporting(false);
    setActionMessage('');
    setRuntimeError('');
    setLoadError('');

    if (!toolbarContainer || !mountRef.current) {
      setState('error');
      setLoadError('The Editor surface could not be mounted.');
      return;
    }

    try {
      const SuperDocCtor = await loadRuntime();
      if (!isCurrent() || !mountRef.current) return;

      const editorUi = {
        comments: false,
        loading: false,
        toolbar: {
          container: toolbarContainer,
          excludeItems: ['zoom'],
          responsiveTo: 'container',
        },
      } satisfies UIConfig;

      const instance = createRuntimeEditor(SuperDocCtor, {
        selector: mountRef.current,
        document: DEMO_DOCUMENT,
        documentMode: 'editing',
        ui: editorUi,
        zoom: {
          mode: 'fit-width',
          fitWidth: {
            min: INITIAL_ZOOM.min,
            max: INITIAL_ZOOM.max,
            padding: EDITOR_DEMO_FIT_WIDTH_PADDING,
          },
        },
        onReady: ({ superdoc }) => {
          if (!isCurrent()) return;
          readyRef.current = true;
          setState('ready');

          const fitWhenMeasured = (attempt: number) => {
            if (!isCurrent() || fitRuntimeEditorToWidth(superdoc) || attempt >= 10) return;
            requestAnimationFrame(() => fitWhenMeasured(attempt + 1));
          };
          fitWhenMeasured(0);
        },
        onContentError: ({ error }) => {
          if (!isCurrent()) return;
          console.error(error);
          // After onReady the document is live and may hold unsaved edits, so
          // report an update failure beside the controls instead of tearing
          // the session down. Teardown is reserved for the initial load.
          if (readyRef.current) {
            setRuntimeError('The document could not be updated.');
            return;
          }
          teardown();
          setState('error');
          setLoadError('The sample document could not be read.');
        },
        onException: (exception) => {
          if (!isCurrent()) return;
          console.error(exception);
          setRuntimeError('The editor reported a runtime error.');
        },
      });
      instanceRef.current = instance;

      const ui = instance.ui;
      uiRef.current = ui;
      setZoom(ui.zoom.getSnapshot());
      setDocumentState(ui.document.getSnapshot());
      const stopObservers = [ui.zoom.observe(setZoom), ui.document.observe(setDocumentState)];
      observerCleanupRef.current = () => stopObservers.forEach((stop) => stop());

      if (!isCurrent()) teardown();
    } catch (cause) {
      if (!isCurrent()) return;
      teardown();
      setState('error');
      setLoadError(cause instanceof Error ? cause.message : 'The demo could not start.');
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
    return () => {
      mountedRef.current = false;
      loadIdRef.current += 1;
      teardown();
    };
  }, [teardown]);

  function changeZoom(delta: number) {
    const ui = uiRef.current;
    if (!ui) return;
    const currentZoom = ui.zoom.getSnapshot();
    ui.zoom.set(Math.min(currentZoom.max, Math.max(currentZoom.min, currentZoom.value + delta)));
  }

  async function downloadDocx() {
    const ui = uiRef.current;
    if (!ui || exportInFlightRef.current) return;

    const loadId = loadIdRef.current;
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
    exportInFlightRef.current = true;
    setIsExporting(true);
    setActionMessage('Preparing the DOCX…');

    try {
      const pendingExport = ui.document.export({
        exportType: ['docx'],
        exportedName: 'custom-document-controls',
        triggerDownload: true,
      });
      if (!pendingExport) {
        if (isCurrent()) setActionMessage('Export is unavailable in this host.');
        return;
      }

      await pendingExport;
      if (isCurrent()) setActionMessage('DOCX downloaded.');
    } catch (cause) {
      if (isCurrent()) {
        setActionMessage(cause instanceof Error ? cause.message : 'The DOCX could not be exported.');
      }
    } finally {
      if (isCurrent()) {
        exportInFlightRef.current = false;
        setIsExporting(false);
      }
    }
  }

  const controlsReady = state === 'ready' && documentState.ready;
  const status =
    state === 'idle' || state === 'loading'
      ? 'Loading the document…'
      : state === 'error'
        ? 'Document unavailable.'
        : `${modeLabel(documentState.mode)} · ${zoom.value}%${actionMessage ? ` · ${actionMessage}` : ''}`;

  return (
    <figure
      className='sd-custom-bold-demo sd-custom-document-controls-demo'
      data-custom-document-controls-demo
      data-state={state}
      ref={rootRef}
    >
      <div
        className='sd-custom-bold-demo-toolbar sd-custom-document-controls-toolbar'
        role='toolbar'
        aria-label='Document controls'
      >
        <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
          Your application
        </span>
        <div className='sd-custom-document-controls-zoom' role='group' aria-label='Zoom'>
          <button
            aria-label='Zoom out'
            disabled={!controlsReady || zoom.value <= zoom.min}
            onClick={() => changeZoom(-ZOOM_STEP)}
            type='button'
          >
            <Minus aria-hidden='true' size={16} />
          </button>
          <button
            aria-pressed={zoom.mode === 'fit-width'}
            disabled={!controlsReady}
            onClick={() => {
              const instance = instanceRef.current;
              if (instance) fitRuntimeEditorToWidth(instance);
            }}
            type='button'
          >
            Fit width
          </button>
          <button
            aria-label='Zoom in'
            disabled={!controlsReady || zoom.value >= zoom.max}
            onClick={() => changeZoom(ZOOM_STEP)}
            type='button'
          >
            <Plus aria-hidden='true' size={16} />
          </button>
        </div>
        <button
          data-testid='custom-document-download'
          disabled={!controlsReady || isExporting}
          onClick={() => void downloadDocx()}
          type='button'
        >
          <Download aria-hidden='true' size={16} />
          Download DOCX
        </button>
        <output className='sd-custom-bold-demo-state' data-testid='custom-document-status' aria-live='polite'>
          {status}
        </output>
      </div>

      <div className='sd-custom-bold-demo-built-in'>
        <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
          SuperDoc UI
        </span>
        <div className='sd-custom-bold-demo-built-in-toolbar' ref={builtInToolbarRef} />
      </div>

      <CollapsibleEditorPreview className='sd-custom-bold-demo-preview' defaultExpanded>
        {loadError ? (
          <div className='sd-custom-bold-demo-error' role='alert'>
            <p>{loadError}</p>
            <button onClick={() => void start()} type='button'>
              Try again
            </button>
          </div>
        ) : null}
        {runtimeError ? (
          <p className='sd-custom-document-controls-error' role='alert'>
            {runtimeError}
          </p>
        ) : null}
        <div className='sd-custom-bold-demo-canvas sd-custom-document-controls-canvas' ref={mountRef} />
      </CollapsibleEditorPreview>
    </figure>
  );
}
