'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserDocumentApi, SuperDocUI, ZoomSlice } from 'superdoc/ui';
import { clauseLibraryOptions, clauseLibraryTag, type ClauseLibraryOptionId } from '@/lib/clause-library';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { loadRuntime, loadUIModule, type SuperDocInstance } from './superdoc-runtime';

const fixture = '/fixtures/clause-library-sample.docx';
const initialZoom = {
  max: 200,
  min: 10,
  fitWidth: { min: 10, max: 200 },
  mode: 'manual',
  value: 100,
} satisfies ZoomSlice;

type DemoState = 'loading' | 'ready' | 'error';

type PageMetricsHandle = {
  getSnapshot(): { pages: ReadonlyArray<{ base: { widthPx: number } }> };
  subscribe(listener: () => void): () => void;
};

function getPageMetrics(instance: SuperDocInstance): PageMetricsHandle | null {
  const candidate = (instance.activeEditor as { pageMetrics?: unknown } | null)?.pageMetrics;
  if (!candidate || typeof candidate !== 'object') return null;
  const metrics = candidate as Partial<PageMetricsHandle>;
  if (typeof metrics.getSnapshot !== 'function' || typeof metrics.subscribe !== 'function') return null;
  return metrics as PageMetricsHandle;
}

export function ClauseLibraryDemo() {
  const demoRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const docRef = useRef<BrowserDocumentApi | null>(null);
  const uiRef = useRef<SuperDocUI | null>(null);
  const fitActiveRef = useRef(true);
  const fitCleanupRef = useRef<(() => void) | null>(null);
  const fitToWidthRef = useRef<(() => void) | null>(null);
  const loadIdRef = useRef(0);
  const zoomRef = useRef<ZoomSlice>(initialZoom);
  const [fitActive, setFitActive] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [selectedClause, setSelectedClause] = useState<ClauseLibraryOptionId>('mutual');
  const [state, setState] = useState<DemoState>('loading');
  const [status, setStatus] = useState('Opening document...');
  const [zoom, setZoom] = useState<ZoomSlice>(initialZoom);

  function destroyEditor() {
    fitCleanupRef.current?.();
    fitCleanupRef.current = null;
    uiRef.current?.destroy();
    uiRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
    docRef.current = null;
    fitToWidthRef.current = null;
  }

  function connectFitToWidth(instance: SuperDocInstance) {
    const mount = mountRef.current;
    const metrics = getPageMetrics(instance);
    if (!mount || !metrics) return;

    const fit = () => {
      if (!fitActiveRef.current) return;
      const pageWidth = metrics.getSnapshot().pages.reduce((width, page) => Math.max(width, page.base.widthPx), 0);
      const availableWidth = mount.clientWidth - 32;
      if (!(pageWidth > 0) || !(availableWidth > 0)) return;
      const nextZoom = Math.max(
        zoomRef.current.min,
        Math.min(zoomRef.current.max, Math.round((availableWidth / pageWidth) * 100)),
      );
      if (nextZoom !== Math.round(zoomRef.current.value)) instance.setZoom(nextZoom);
    };

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(mount);
    const unsubscribe = metrics.subscribe(fit);
    fitCleanupRef.current = () => {
      resizeObserver.disconnect();
      unsubscribe();
    };
    fitToWidthRef.current = fit;
    fit();
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active =
        document.fullscreenElement === document.documentElement && demoRef.current?.dataset.fullscreen === 'true';
      if (!active && demoRef.current) delete demoRef.current.dataset.fullscreen;
      setIsFullscreen(active);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const loadId = ++loadIdRef.current;
    let disposed = false;
    setState('loading');
    setStatus('Opening document...');

    async function load() {
      try {
        const [response, SuperDoc, uiModule] = await Promise.all([fetch(fixture), loadRuntime(), loadUIModule()]);
        if (!response.ok) throw new Error(`Fixture request failed with ${response.status}.`);
        if (disposed || loadId !== loadIdRef.current || !mountRef.current) return;

        const file = new File([await response.blob()], 'clause-library-sample.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        if (disposed || loadId !== loadIdRef.current || !mountRef.current) return;

        destroyEditor();
        const instance = new SuperDoc({
          selector: mountRef.current,
          document: file,
          ui: { comments: false, contentControls: true, toolbar: false },
          zoom: { mode: 'manual', fitWidth: { min: initialZoom.min, max: initialZoom.max } },
          onReady: ({ superdoc }) => {
            const doc = superdoc.activeEditor?.doc;
            if (!doc || disposed || loadId !== loadIdRef.current) return;
            docRef.current = doc;
            connectFitToWidth(superdoc);

            void Promise.resolve(doc.contentControls.selectByTag({ tag: clauseLibraryTag }))
              .then(({ items }) => {
                if (disposed || loadId !== loadIdRef.current) return;
                if (items.length !== 1 || items[0]?.kind !== 'block') {
                  setState('error');
                  setStatus('The clause slot is missing or has the wrong shape.');
                  return;
                }
                const selected = clauseLibraryOptions.find(({ content }) => content === items[0]?.text)?.id ?? 'mutual';
                setSelectedClause(selected);
                setState('ready');
                setStatus('Choose a clause.');
              })
              .catch(() => {
                if (disposed || loadId !== loadIdRef.current) return;
                setState('error');
                setStatus('The clause slot could not be read.');
              });
          },
          onException: () => {
            if (disposed || loadId !== loadIdRef.current) return;
            setState('error');
            setStatus('The document could not be opened.');
          },
        });
        instanceRef.current = instance;

        const ui = uiModule.createSuperDocUI({ superdoc: instance });
        uiRef.current = ui;
        ui.zoom.observe((snapshot) => {
          zoomRef.current = snapshot;
          if (!disposed) setZoom(snapshot);
        });
      } catch {
        if (disposed || loadId !== loadIdRef.current) return;
        setState('error');
        setStatus('The document could not be opened.');
      }
    }

    void load();
    return () => {
      disposed = true;
      destroyEditor();
    };
  }, [resetKey]);

  async function chooseClause(id: ClauseLibraryOptionId) {
    const doc = docRef.current;
    const option = clauseLibraryOptions.find((candidate) => candidate.id === id);
    if (!doc || !option) return;

    setIsUpdating(true);
    setStatus('Replacing clause...');
    try {
      const { items } = await doc.contentControls.selectByTag({ tag: clauseLibraryTag });
      if (items.length !== 1 || items[0]?.kind !== 'block') throw new Error('Clause slot not found.');

      const receipt = await doc.contentControls.replaceContent({
        target: items[0].target,
        content: option.content,
        format: 'text',
      });
      if (!receipt.success && receipt.failure.code !== 'NO_OP') throw new Error(receipt.failure.message);

      setSelectedClause(id);
      setStatus(receipt.success ? `Showing ${option.label}.` : `${option.label} is already selected.`);
    } catch {
      setStatus('The clause could not be replaced.');
    } finally {
      setIsUpdating(false);
    }
  }

  function changeZoom(direction: -1 | 1) {
    const nextZoom = Math.max(1, zoom.value + direction * 10);
    fitActiveRef.current = false;
    setFitActive(false);
    uiRef.current?.zoom.set(nextZoom);
  }

  function fitToWidth() {
    fitActiveRef.current = true;
    setFitActive(true);
    fitToWidthRef.current?.();
  }

  async function toggleFullscreen() {
    const demo = demoRef.current;
    if (!demo) return;
    if (document.fullscreenElement === document.documentElement && demo.dataset.fullscreen === 'true') {
      await document.exitFullscreen();
      return;
    }
    demo.dataset.fullscreen = 'true';
    try {
      await document.documentElement.requestFullscreen();
      window.requestAnimationFrame(() => fitToWidthRef.current?.());
    } catch {
      delete demo.dataset.fullscreen;
    }
  }

  function resetDocument() {
    fitActiveRef.current = true;
    setFitActive(true);
    setSelectedClause('mutual');
    zoomRef.current = initialZoom;
    setZoom(initialZoom);
    setResetKey((current) => current + 1);
  }

  return (
    <section ref={demoRef} className='sd-editor-demo sd-clause-library-demo' aria-label='Clause library'>
      <div className='sd-editor-demo-header'>
        <div className='sd-editor-demo-copy'>
          <strong>Choose a confidentiality clause</strong>
          <span aria-live='polite'>{status}</span>
        </div>
        <div className='sd-editor-demo-actions'>
          <EditorDemoViewControls
            disabled={state !== 'ready' || isUpdating}
            fitActive={fitActive}
            isFullscreen={isFullscreen}
            onFit={fitToWidth}
            onFullscreen={() => void toggleFullscreen()}
            onZoom={changeZoom}
            zoom={zoom}
          />
          <button
            className='sd-editor-demo-config-reset'
            type='button'
            aria-label='Reset the clause'
            disabled={state === 'loading' || isUpdating}
            onClick={resetDocument}
          >
            <RotateCcw aria-hidden='true' />
          </button>
        </div>
      </div>

      <CollapsibleEditorPreview
        className='sd-editor-demo-preview'
        onCollapse={() => mountRef.current?.scrollTo({ top: 0 })}
      >
        <div className='sd-clause-library-layout'>
          <div className='sd-clause-library-options'>
            <span>Clause library</span>
            <div role='group' aria-label='Confidentiality clauses'>
              {clauseLibraryOptions.map((option) => (
                <button
                  key={option.id}
                  type='button'
                  aria-pressed={selectedClause === option.id}
                  disabled={state !== 'ready' || isUpdating}
                  onClick={() => void chooseClause(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className='sd-clause-library-editor'>
            {state === 'error' ? (
              <p className='sd-editor-demo-error' role='alert'>
                The clause demo could not be opened. Try again.
              </p>
            ) : null}
            <div ref={mountRef} className='sd-editor-demo-surface' aria-busy={state === 'loading'} />
          </div>
        </div>
      </CollapsibleEditorPreview>
    </section>
  );
}
