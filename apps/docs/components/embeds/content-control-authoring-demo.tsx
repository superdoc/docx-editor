'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserDocumentApi, ContentControlInfo, SelectionSlice, SuperDocUI, ZoomSlice } from 'superdoc/ui';
import { getReadyAuthoringTarget } from '../../lib/content-control-authoring';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { loadRuntime, loadUIModule, type SuperDocInstance } from './superdoc-runtime';

const fixture = '/fixtures/service-agreement-draft.docx';
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

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The field could not be added.';
}

export function ContentControlAuthoringDemo() {
  const demoRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const docRef = useRef<BrowserDocumentApi | null>(null);
  const uiRef = useRef<SuperDocUI | null>(null);
  const latestSelectionRef = useRef<SelectionSlice | null>(null);
  const cleanupRef = useRef<(() => void)[]>([]);
  const fitActiveRef = useRef(true);
  const fitCleanupRef = useRef<(() => void) | null>(null);
  const fitToWidthRef = useRef<(() => void) | null>(null);
  const loadIdRef = useRef(0);
  const zoomRef = useRef<ZoomSlice>(initialZoom);
  const [controls, setControls] = useState<readonly ContentControlInfo[]>([]);
  const [createdTags, setCreatedTags] = useState<ReadonlySet<string>>(() => new Set());
  const [fitActive, setFitActive] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [state, setState] = useState<DemoState>('loading');
  const [status, setStatus] = useState('Opening document...');
  const [zoom, setZoom] = useState<ZoomSlice>(initialZoom);

  const hasClientField =
    createdTags.has('client.legalName') || controls.some((control) => control.properties.tag === 'client.legalName');
  const hasClauseField =
    createdTags.has('agreement.confidentiality') ||
    controls.some((control) => control.properties.tag === 'agreement.confidentiality');
  const canExport = hasClientField && hasClauseField;

  function destroyEditor() {
    cleanupRef.current.splice(0).forEach((cleanup) => cleanup());
    fitCleanupRef.current?.();
    fitCleanupRef.current = null;
    uiRef.current?.destroy();
    uiRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
    docRef.current = null;
    latestSelectionRef.current = null;
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

  async function refreshControls() {
    const doc = docRef.current;
    if (!doc) return;
    const result = await doc.contentControls.list();
    setControls(result.items);
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
    setControls([]);
    setCreatedTags(new Set());

    async function load() {
      try {
        const [response, SuperDoc, uiModule] = await Promise.all([fetch(fixture), loadRuntime(), loadUIModule()]);
        if (!response.ok) throw new Error(`Fixture request failed with ${response.status}.`);
        if (disposed || loadId !== loadIdRef.current || !mountRef.current) return;

        const file = new File([await response.blob()], 'service-agreement-draft.docx', {
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
            if (disposed || loadId !== loadIdRef.current) return;
            const doc = superdoc.activeEditor?.doc;
            if (!doc) {
              setState('error');
              setStatus('The Document API is not ready.');
              return;
            }

            docRef.current = doc;
            connectFitToWidth(superdoc);
            cleanupRef.current.push(
              superdoc.ui.selection.observe((snapshot) => {
                latestSelectionRef.current = snapshot;
              }),
            );
            void refreshControls()
              .then(() => {
                setState('ready');
                setStatus('Select the client name to add the first field.');
              })
              .catch((error: unknown) => {
                setState('error');
                setStatus(failureMessage(error));
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
        cleanupRef.current.push(
          ui.zoom.observe((snapshot) => {
            zoomRef.current = snapshot;
            if (!disposed) setZoom(snapshot);
          }),
        );
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

  async function addInlineField() {
    const doc = docRef.current;
    const target = getReadyAuthoringTarget(latestSelectionRef.current, false);
    if (!doc || !target) {
      setStatus('Select “Acme Products, Inc.” first.');
      return;
    }

    setIsMutating(true);
    try {
      const receipt = await doc.create.contentControl({
        kind: 'inline',
        controlType: 'text',
        tag: 'client.legalName',
        alias: 'Client legal name',
        at: target,
      });
      if (!receipt.success) {
        setStatus(receipt.failure.message);
        return;
      }
      setCreatedTags((current) => new Set(current).add('client.legalName'));
      try {
        await refreshControls();
        setStatus('Inline field added. Place the caret below Confidentiality.');
      } catch {
        setStatus('Inline field added, but the detected-fields list could not be refreshed.');
      }
    } catch (error) {
      setStatus(failureMessage(error));
    } finally {
      setIsMutating(false);
    }
  }

  async function addBlockField() {
    const doc = docRef.current;
    const target = getReadyAuthoringTarget(latestSelectionRef.current, true);
    if (!doc || !target) {
      setStatus('Place the caret on the empty line below Confidentiality first.');
      return;
    }

    setIsMutating(true);
    try {
      const receipt = await doc.create.contentControl({
        kind: 'block',
        controlType: 'richText',
        tag: 'agreement.confidentiality',
        alias: 'Confidentiality clause',
        html: '<p>Each party will protect confidential information with reasonable care and use it only to perform this agreement.</p>',
        at: target,
      });
      if (!receipt.success) {
        setStatus(receipt.failure.message);
        return;
      }
      setCreatedTags((current) => new Set(current).add('agreement.confidentiality'));
      try {
        await refreshControls();
        setStatus('Block field added. The template is ready to export.');
      } catch {
        setStatus('Block field added, but the detected-fields list could not be refreshed.');
      }
    } catch (error) {
      setStatus(failureMessage(error));
    } finally {
      setIsMutating(false);
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

  async function exportDocument() {
    const instance = instanceRef.current;
    if (!instance) return;
    setIsExporting(true);
    setStatus('Exporting DOCX...');
    try {
      await instance.export({ exportType: ['docx'], exportedName: 'service-agreement-template' });
      setStatus('Template exported.');
    } catch {
      setStatus('The template could not be exported.');
    } finally {
      setIsExporting(false);
    }
  }

  function resetDocument() {
    fitActiveRef.current = true;
    setFitActive(true);
    zoomRef.current = initialZoom;
    setZoom(initialZoom);
    setResetKey((current) => current + 1);
  }

  const disabled = state !== 'ready' || isMutating || isExporting;

  return (
    <section
      ref={demoRef}
      className='sd-editor-demo sd-content-control-authoring-demo'
      aria-label='Add fields to the template'
      data-state={state}
    >
      <div className='sd-editor-demo-header'>
        <div className='sd-editor-demo-copy'>
          <strong>Add template fields</strong>
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
            aria-label='Reset the document'
            disabled={state === 'loading' || isMutating || isExporting}
            onClick={resetDocument}
          >
            <RotateCcw aria-hidden='true' />
          </button>
          <button type='button' disabled={disabled || !canExport} onClick={() => void exportDocument()}>
            Export template
          </button>
        </div>
      </div>

      <CollapsibleEditorPreview
        className='sd-editor-demo-preview'
        onCollapse={() => mountRef.current?.scrollTo({ top: 0 })}
      >
        <div className='sd-content-control-authoring-layout'>
          <aside className='sd-content-control-authoring-panel' aria-label='Template field actions'>
            <div>
              <strong>1. Client name</strong>
              <span>Select “Acme Products, Inc.”</span>
              <button type='button' disabled={disabled || hasClientField} onClick={() => void addInlineField()}>
                Add inline field
              </button>
            </div>
            <div>
              <strong>2. Confidentiality</strong>
              <span>Place the caret on the empty line.</span>
              <button type='button' disabled={disabled || hasClauseField} onClick={() => void addBlockField()}>
                Add block field
              </button>
            </div>
            <div className='sd-content-control-authoring-detected'>
              <strong>Detected fields</strong>
              {controls.length === 0 ? (
                <span>None yet</span>
              ) : (
                <ul>
                  {controls.map((control) => (
                    <li key={control.id}>
                      <span>{control.properties.alias ?? 'Untitled field'}</span>
                      <code>{control.properties.tag ?? 'No tag'}</code>
                      <small>
                        {control.kind} · {control.controlType}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
          <div className='sd-content-control-authoring-editor'>
            {state === 'error' ? (
              <p className='sd-editor-demo-error' role='alert'>
                The document could not be opened. Try again.
              </p>
            ) : null}
            <div ref={mountRef} className='sd-editor-demo-surface' aria-busy={state === 'loading'} />
          </div>
        </div>
      </CollapsibleEditorPreview>
    </section>
  );
}
