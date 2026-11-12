'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LockMode } from '@superdoc/document-api';
import type { BrowserDocumentApi, ContentControlInfo, SuperDocUI, ZoomSlice } from 'superdoc/ui';
import {
  getContentControlLockMode,
  getContentControlLockOptions,
  type ContentControlLockOptions,
} from '@/lib/content-control-locks';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { loadRuntime, loadUIModule, type SuperDocInstance } from './superdoc-runtime';

const fixture = '/fixtures/service-agreement-template.docx';
const fieldTag = 'client.address';
const initialAddress = '100 Market Street, San Francisco, CA 94105';
const replacementAddress = '250 Market Street, San Francisco, CA 94105';
const initialZoom = {
  max: 200,
  min: 10,
  fitWidth: { min: 10, max: 200 },
  mode: 'manual',
  value: 100,
} satisfies ZoomSlice;

type DemoState = 'loading' | 'ready' | 'error';
type LockableControl = Pick<ContentControlInfo, 'lockMode' | 'target'>;

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

function describeLocks(options: ContentControlLockOptions) {
  const contents = options.cannotEdit ? 'Contents protected' : 'Contents editable';
  const control = options.cannotDelete ? 'control protected' : 'control removable';
  return `${contents} · ${control}.`;
}

export function ContentControlLocksDemo() {
  const demoRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const docRef = useRef<BrowserDocumentApi | null>(null);
  const controlRef = useRef<LockableControl | null>(null);
  const uiRef = useRef<SuperDocUI | null>(null);
  const fitActiveRef = useRef(true);
  const fitCleanupRef = useRef<(() => void) | null>(null);
  const fitToWidthRef = useRef<(() => void) | null>(null);
  const loadIdRef = useRef(0);
  const zoomRef = useRef<ZoomSlice>(initialZoom);
  const [busy, setBusy] = useState(false);
  const [fieldRemoved, setFieldRemoved] = useState(false);
  const [fitActive, setFitActive] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lockOptions, setLockOptions] = useState<ContentControlLockOptions>({
    cannotDelete: false,
    cannotEdit: false,
  });
  const [resetKey, setResetKey] = useState(0);
  const [state, setState] = useState<DemoState>('loading');
  const [status, setStatus] = useState('Opening template...');
  const [usingReplacementAddress, setUsingReplacementAddress] = useState(false);
  const [zoom, setZoom] = useState<ZoomSlice>(initialZoom);

  function destroyEditor() {
    fitCleanupRef.current?.();
    fitCleanupRef.current = null;
    uiRef.current?.destroy();
    uiRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
    docRef.current = null;
    controlRef.current = null;
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
    setStatus('Opening template...');

    async function load() {
      try {
        const [response, SuperDoc, uiModule] = await Promise.all([fetch(fixture), loadRuntime(), loadUIModule()]);
        if (!response.ok) throw new Error(`Fixture request failed with ${response.status}.`);
        if (disposed || loadId !== loadIdRef.current || !mountRef.current) return;

        const file = new File([await response.blob()], 'service-agreement-template.docx', {
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

            void Promise.resolve(doc.contentControls.selectByTag({ tag: fieldTag }))
              .then(({ items }) => {
                if (disposed || loadId !== loadIdRef.current) return;
                if (items.length !== 1 || items[0]?.controlType !== 'text') {
                  setState('error');
                  setStatus('The client address field is missing or has the wrong type.');
                  return;
                }

                const control = items[0];
                controlRef.current = control;
                const options = getContentControlLockOptions(control.lockMode);
                setLockOptions(options);
                setState('ready');
                setStatus(describeLocks(options));
              })
              .catch(() => {
                if (disposed || loadId !== loadIdRef.current) return;
                setState('error');
                setStatus('The client address field could not be read.');
              });
          },
          onException: () => {
            if (disposed || loadId !== loadIdRef.current) return;
            setState('error');
            setStatus('The template could not be opened.');
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
        setStatus('The template could not be opened.');
      }
    }

    void load();
    return () => {
      disposed = true;
      destroyEditor();
    };
  }, [resetKey]);

  async function applyLockOptions(options: ContentControlLockOptions) {
    const doc = docRef.current;
    const control = controlRef.current;
    if (!doc || !control) return;

    setBusy(true);
    setStatus('Applying field locks...');
    try {
      const lockMode = getContentControlLockMode(options);
      const receipt = await doc.contentControls.setLockMode({ target: control.target, lockMode });
      if (!receipt.success && receipt.failure.code !== 'NO_OP') throw new Error(receipt.failure.message);

      controlRef.current = { ...control, lockMode };
      setLockOptions(options);
      setStatus(describeLocks(options));
    } catch {
      setStatus('The field locks could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  async function changeContents() {
    const doc = docRef.current;
    const control = controlRef.current;
    if (!doc || !control) return;

    setBusy(true);
    setStatus('Changing field contents...');
    try {
      const nextValue = usingReplacementAddress ? initialAddress : replacementAddress;
      const receipt = await doc.contentControls.text.setValue({ target: control.target, value: nextValue });
      if (!receipt.success && receipt.failure.code !== 'NO_OP') throw new Error(receipt.failure.message);

      setUsingReplacementAddress(!usingReplacementAddress);
      setStatus(receipt.success ? 'Field contents changed.' : 'Field contents already match.');
    } catch {
      setStatus(
        lockOptions.cannotEdit ? 'Change blocked: contents cannot be edited.' : 'The field could not be changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteField() {
    const doc = docRef.current;
    const control = controlRef.current;
    if (!doc || !control) return;

    setBusy(true);
    setStatus('Deleting field...');
    try {
      const receipt = await doc.contentControls.delete({ target: control.target });
      if (!receipt.success) throw new Error(receipt.failure.message);

      controlRef.current = null;
      setFieldRemoved(true);
      setStatus('Field deleted. Reset the demo to restore it.');
    } catch {
      setStatus(
        lockOptions.cannotDelete ? 'Delete blocked: the control cannot be deleted.' : 'The field could not be deleted.',
      );
    } finally {
      setBusy(false);
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
    setFieldRemoved(false);
    setLockOptions({ cannotDelete: false, cannotEdit: false });
    setUsingReplacementAddress(false);
    zoomRef.current = initialZoom;
    setZoom(initialZoom);
    setResetKey((current) => current + 1);
  }

  const controlsDisabled = state !== 'ready' || busy || fieldRemoved;

  return (
    <section ref={demoRef} className='sd-editor-demo sd-content-control-locks-demo' aria-label='Lock a template field'>
      <div className='sd-editor-demo-header'>
        <div className='sd-editor-demo-copy'>
          <strong>Lock a template field</strong>
          <span aria-live='polite'>{status}</span>
        </div>
        <div className='sd-editor-demo-actions'>
          <EditorDemoViewControls
            disabled={state !== 'ready'}
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
            aria-label='Reset the template'
            disabled={state === 'loading' || busy}
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
        <div className='sd-content-control-locks-layout'>
          <fieldset className='sd-content-control-locks-panel' disabled={controlsDisabled}>
            <legend>Field protection</legend>
            <code>{fieldTag}</code>
            <label>
              <input
                type='checkbox'
                checked={lockOptions.cannotDelete}
                onChange={(event) => void applyLockOptions({ ...lockOptions, cannotDelete: event.target.checked })}
              />
              Content control cannot be deleted
            </label>
            <label>
              <input
                type='checkbox'
                checked={lockOptions.cannotEdit}
                onChange={(event) => void applyLockOptions({ ...lockOptions, cannotEdit: event.target.checked })}
              />
              Contents cannot be edited
            </label>
            <div className='sd-content-control-locks-actions'>
              <button type='button' onClick={() => void changeContents()}>
                Change contents
              </button>
              <button type='button' onClick={() => void deleteField()}>
                Delete field
              </button>
            </div>
          </fieldset>
          <div className='sd-content-control-locks-editor'>
            {state === 'error' ? (
              <p className='sd-editor-demo-error' role='alert'>
                The field-locking demo could not be opened. Try again.
              </p>
            ) : null}
            <div ref={mountRef} className='sd-editor-demo-surface' aria-busy={state === 'loading'} />
          </div>
        </div>
      </CollapsibleEditorPreview>
    </section>
  );
}
