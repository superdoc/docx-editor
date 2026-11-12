'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserDocumentApi, SuperDocUI, ZoomSlice } from 'superdoc/ui';
import {
  createTemplatePopulationUpdateQueue,
  templatePopulationFields,
  type TemplatePopulationFieldKey,
  type TemplatePopulationUpdateContext,
} from '@/lib/template-population';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { loadRuntime, loadUIModule, type SuperDocInstance } from './superdoc-runtime';

const fixture = '/fixtures/service-agreement-template.docx';
const initialZoom = {
  max: 200,
  min: 10,
  fitWidth: { min: 10, max: 200 },
  mode: 'manual',
  value: 100,
} satisfies ZoomSlice;
const { autoRenew: autoRenewField, clientLegalName: clientLegalNameField } = templatePopulationFields;
const initialValues = {
  autoRenew: false,
  clientLegalName: 'Acme Products, Inc.',
};

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

function describeUpdate(updated: number, matched: number, unchanged: number) {
  if (matched === 0) return 'No matching controls.';
  if (updated + unchanged < matched) return `Updated ${updated} of ${matched} locations.`;
  if (updated === 0) return `${matched} locations already match.`;
  return `Updated ${updated} ${updated === 1 ? 'location' : 'locations'}.`;
}

export function TemplatePopulationDemo() {
  const demoRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const docRef = useRef<BrowserDocumentApi | null>(null);
  const hydratedRef = useRef(false);
  const uiRef = useRef<SuperDocUI | null>(null);
  const cleanupRef = useRef<(() => void)[]>([]);
  const inputTimerRef = useRef<number | null>(null);
  const pendingTextRef = useRef<string | null>(null);
  const updateQueueRef = useRef(createTemplatePopulationUpdateQueue<BrowserDocumentApi>());
  const loadIdRef = useRef(0);
  const fitActiveRef = useRef(true);
  const fitCleanupRef = useRef<(() => void) | null>(null);
  const fitToWidthRef = useRef<(() => void) | null>(null);
  const zoomRef = useRef<ZoomSlice>(initialZoom);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [state, setState] = useState<DemoState>('loading');
  const [status, setStatus] = useState('Opening template...');
  const [values, setValues] = useState(initialValues);
  const [fitActive, setFitActive] = useState(true);
  const [zoom, setZoom] = useState<ZoomSlice>(initialZoom);

  function destroyEditor() {
    updateQueueRef.current.invalidate();
    cleanupRef.current.splice(0).forEach((cleanup) => cleanup());
    fitCleanupRef.current?.();
    fitCleanupRef.current = null;
    uiRef.current?.destroy();
    uiRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
    docRef.current = null;
    hydratedRef.current = false;
    fitToWidthRef.current = null;
  }

  function connectFitToWidth(instance: SuperDocInstance) {
    if (fitCleanupRef.current) return;
    const mount = mountRef.current;
    const metrics = getPageMetrics(instance);
    if (!mount || !metrics) return;

    const fit = () => {
      if (!fitActiveRef.current) return;
      const widestPage = metrics.getSnapshot().pages.reduce((width, page) => Math.max(width, page.base.widthPx), 0);
      const availableWidth = mount.clientWidth - 32;
      if (!(widestPage > 0) || !(availableWidth > 0)) return;
      const nextZoom = Math.max(
        zoomRef.current.min,
        Math.min(zoomRef.current.max, Math.round((availableWidth / widestPage) * 100)),
      );
      if (nextZoom === Math.round(zoomRef.current.value)) return;
      instance.setZoom(nextZoom);
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
            if (disposed || loadId !== loadIdRef.current) return;
            const doc = superdoc.activeEditor?.doc;
            if (!doc) {
              setState('error');
              setStatus('The Document API is not ready.');
              return;
            }

            docRef.current = doc;
            updateQueueRef.current.activate(doc);
            connectFitToWidth(superdoc);
            const controls = superdoc.ui.contentControls;
            cleanupRef.current.push(
              controls.observe((snapshot) => {
                if (disposed || loadId !== loadIdRef.current) return;
                const name = snapshot.items.find(
                  (control) =>
                    control.properties.tag === clientLegalNameField.tag &&
                    control.controlType === clientLegalNameField.type,
                );
                const autoRenew = snapshot.items.find(
                  (control) =>
                    control.properties.tag === autoRenewField.tag && control.controlType === autoRenewField.type,
                );
                if (name && autoRenew) {
                  if (!hydratedRef.current) {
                    hydratedRef.current = true;
                    setValues({
                      autoRenew: autoRenew.properties.checked ?? false,
                      clientLegalName: name.text ?? '',
                    });
                    setStatus('Template ready.');
                  }
                  setState('ready');
                }
              }),
            );
            controls.list();
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
        cleanupRef.current.push(
          ui.zoom.observe((snapshot) => {
            zoomRef.current = snapshot;
            if (!disposed) setZoom(snapshot);
          }),
        );
      } catch {
        if (disposed || loadId !== loadIdRef.current) return;
        setState('error');
        setStatus('The template could not be opened.');
      }
    }

    void load();
    return () => {
      disposed = true;
      if (inputTimerRef.current) window.clearTimeout(inputTimerRef.current);
      inputTimerRef.current = null;
      pendingTextRef.current = null;
      destroyEditor();
    };
  }, [resetKey]);

  async function updateText(
    { document: doc, isCurrent }: TemplatePopulationUpdateContext<BrowserDocumentApi>,
    value: string,
  ) {
    const { items } = await doc.contentControls.selectByTag({ tag: clientLegalNameField.tag });
    if (!isCurrent()) return false;
    const controls = items.filter((control) => control.controlType === 'text');
    let updated = 0;
    let unchanged = 0;
    for (const control of controls) {
      if (!isCurrent()) return false;
      try {
        const receipt = await doc.contentControls.text.setValue({ target: control.target, value });
        if (!isCurrent()) return false;
        if (receipt.success) updated += 1;
        else if (receipt.failure.code === 'NO_OP') unchanged += 1;
      } catch {
        continue;
      }
    }
    if (!isCurrent()) return false;
    setStatus(describeUpdate(updated, controls.length, unchanged));
    return controls.length > 0 && updated + unchanged === controls.length;
  }

  function queueUpdate(
    field: TemplatePopulationFieldKey,
    update: (context: TemplatePopulationUpdateContext<BrowserDocumentApi>) => Promise<boolean>,
  ) {
    return updateQueueRef.current.enqueue(field, async (context) => {
      try {
        return await update(context);
      } catch {
        if (context.isCurrent()) setStatus('The document could not be updated.');
        return false;
      }
    });
  }

  function flushTextUpdate() {
    if (inputTimerRef.current) {
      window.clearTimeout(inputTimerRef.current);
      inputTimerRef.current = null;
    }
    const value = pendingTextRef.current;
    if (value === null) return;
    pendingTextRef.current = null;
    void queueUpdate('clientLegalName', (context) => updateText(context, value));
  }

  function changeName(value: string) {
    setValues((current) => ({ ...current, clientLegalName: value }));
    setStatus('Updating document...');
    if (inputTimerRef.current) window.clearTimeout(inputTimerRef.current);
    pendingTextRef.current = value;
    inputTimerRef.current = window.setTimeout(flushTextUpdate, 250);
  }

  async function changeAutoRenew(checked: boolean) {
    setValues((current) => ({ ...current, autoRenew: checked }));
    setStatus('Updating document...');
    await queueUpdate('autoRenew', (context) => updateAutoRenew(context, checked));
  }

  async function updateAutoRenew(
    { document: doc, isCurrent }: TemplatePopulationUpdateContext<BrowserDocumentApi>,
    checked: boolean,
  ) {
    const { items } = await doc.contentControls.selectByTag({ tag: autoRenewField.tag });
    if (!isCurrent()) return false;
    const controls = items.filter((control) => control.controlType === 'checkbox');
    let updated = 0;
    let unchanged = 0;
    for (const control of controls) {
      if (!isCurrent()) return false;
      try {
        const receipt = await doc.contentControls.checkbox.setState({ target: control.target, checked });
        if (!isCurrent()) return false;
        if (receipt.success) updated += 1;
        else if (receipt.failure.code === 'NO_OP') unchanged += 1;
      } catch {
        continue;
      }
    }
    if (!isCurrent()) return false;
    setStatus(describeUpdate(updated, controls.length, unchanged));
    return controls.length > 0 && updated + unchanged === controls.length;
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
      flushTextUpdate();
      await updateQueueRef.current.wait();
      if (updateQueueRef.current.hasFailures()) {
        setStatus('Fix failed field updates before exporting.');
        return;
      }
      await instance.export({ exportType: ['docx'], exportedName: 'service-agreement' });
      setStatus('DOCX exported.');
    } catch {
      setStatus('The DOCX could not be exported.');
    } finally {
      setIsExporting(false);
    }
  }

  function resetDocument() {
    updateQueueRef.current.invalidate();
    if (inputTimerRef.current) window.clearTimeout(inputTimerRef.current);
    inputTimerRef.current = null;
    pendingTextRef.current = null;
    setValues(initialValues);
    fitActiveRef.current = true;
    setFitActive(true);
    zoomRef.current = initialZoom;
    setZoom(initialZoom);
    setResetKey((current) => current + 1);
  }

  return (
    <section
      ref={demoRef}
      className='sd-editor-demo sd-template-population-demo'
      aria-label='Fill the template'
      data-state={state}
    >
      <div className='sd-editor-demo-header'>
        <div className='sd-editor-demo-copy'>
          <strong>Fill the template</strong>
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
            disabled={state === 'loading' || isExporting}
            onClick={resetDocument}
          >
            <RotateCcw aria-hidden='true' />
          </button>
          <button type='button' disabled={state !== 'ready' || isExporting} onClick={() => void exportDocument()}>
            Export DOCX
          </button>
        </div>
      </div>

      <CollapsibleEditorPreview
        className='sd-editor-demo-preview'
        onCollapse={() => mountRef.current?.scrollTo({ top: 0 })}
      >
        <div className='sd-template-population-layout'>
          <form
            className='sd-template-population-form'
            aria-label='Application fields'
            onSubmit={(event) => event.preventDefault()}
          >
            <span className='sd-template-population-owner'>Application form</span>
            <label>
              <span>{clientLegalNameField.label}</span>
              <input
                type='text'
                value={values.clientLegalName}
                disabled={state !== 'ready' || isExporting}
                onChange={(event) => changeName(event.target.value)}
              />
              <code>
                {clientLegalNameField.tag} · {clientLegalNameField.occurrences} locations
              </code>
            </label>
            <label className='sd-template-population-checkbox'>
              <span>
                <input
                  type='checkbox'
                  checked={values.autoRenew}
                  disabled={state !== 'ready' || isExporting}
                  onChange={(event) => void changeAutoRenew(event.target.checked)}
                />
                {autoRenewField.label}
              </span>
              <code>{autoRenewField.tag}</code>
            </label>
          </form>
          <div className='sd-template-population-editor'>
            {state === 'error' ? (
              <p className='sd-editor-demo-error' role='alert'>
                The template could not be opened. Try again.
              </p>
            ) : null}
            <div ref={mountRef} className='sd-editor-demo-surface' aria-busy={state === 'loading'} />
          </div>
        </div>
      </CollapsibleEditorPreview>
    </section>
  );
}
