'use client';

import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIConfig } from 'superdoc';
import type { ContentControlInfo, ContentControlsSlice, ZoomSlice } from 'superdoc/ui';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { EDITOR_DEMO_FIT_WIDTH_PADDING, fitRuntimeEditorToWidth } from './editor-demo-zoom';
import { createRuntimeEditor, loadRuntime, type SuperDocInstance } from './superdoc-runtime';

const DEMO_DOCUMENT = '/fixtures/custom-content-controls-workflow.docx';
const INITIAL_ZOOM = { max: 200, min: 10, mode: 'manual', value: 80 } satisfies ZoomSlice;
const INITIAL_CONTENT_CONTROLS = {
  status: 'pending',
  items: [],
  total: 0,
  activeId: null,
  activeIds: [],
} satisfies ContentControlsSlice;

type DemoState = 'idle' | 'loading' | 'ready' | 'error';
type PendingMutation =
  | { checked: boolean; controlId: string; controlName: string; kind: 'checkbox' }
  | { controlId: string; controlName: string; kind: 'text'; value: string };

function fieldCountLabel(count: number) {
  return `${count} document ${count === 1 ? 'field' : 'fields'}`;
}

function fieldName(control: ContentControlInfo) {
  return control.properties.alias ?? control.properties.tag ?? control.controlType;
}

function fieldTypeLabel(control: ContentControlInfo) {
  return control.controlType === 'checkbox'
    ? 'Checkbox'
    : control.controlType === 'text'
      ? 'Text field'
      : control.controlType;
}

function isContentLocked(control: ContentControlInfo) {
  return control.lockMode === 'contentLocked' || control.lockMode === 'sdtContentLocked';
}

function mutationIsObserved(control: ContentControlInfo, mutation: PendingMutation) {
  if (control.id !== mutation.controlId) return false;
  if (mutation.kind === 'checkbox') return control.properties.checked === mutation.checked;
  return control.text === mutation.value;
}

function successMessage(mutation: PendingMutation) {
  if (mutation.kind === 'checkbox') {
    return `${mutation.controlName} ${mutation.checked ? 'checked' : 'unchecked'}.`;
  }
  return `${mutation.controlName} updated.`;
}

export function CustomContentControlsDemo() {
  const rootRef = useRef<HTMLElement>(null);
  const builtInToolbarRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const observerCleanupRef = useRef<(() => void) | null>(null);
  const pendingMutationRef = useRef<PendingMutation | null>(null);
  const catalogReadIdRef = useRef(0);
  const loadIdRef = useRef(0);
  const mountedRef = useRef(true);
  const zoomRef = useRef<ZoomSlice>(INITIAL_ZOOM);

  const [state, setState] = useState<DemoState>('idle');
  const [contentControls, setContentControls] = useState<ContentControlsSlice>(INITIAL_CONTENT_CONTROLS);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState<ZoomSlice>(INITIAL_ZOOM);
  const [message, setMessage] = useState('Choose a field to edit it.');
  const [loadError, setLoadError] = useState('');

  const applyContentControlsSnapshot = useCallback((snapshot: ContentControlsSlice) => {
    setContentControls(snapshot);

    const pending = pendingMutationRef.current;
    const updatedControl = pending && snapshot.items.find((control) => mutationIsObserved(control, pending));
    if (!pending || !updatedControl) return;

    pendingMutationRef.current = null;
    setPendingMutation(null);
    if (pending.kind === 'text') {
      setDrafts((current) => {
        const next = { ...current };
        delete next[pending.controlId];
        return next;
      });
    }
    setMessage(successMessage(pending));
  }, []);

  const teardown = useCallback(() => {
    observerCleanupRef.current?.();
    observerCleanupRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
    pendingMutationRef.current = null;
    catalogReadIdRef.current += 1;
  }, []);

  const start = useCallback(async () => {
    const loadId = (loadIdRef.current += 1);
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
    const toolbarContainer = builtInToolbarRef.current;

    teardown();
    setState('loading');
    setContentControls(INITIAL_CONTENT_CONTROLS);
    setDrafts({});
    setPendingMutation(null);
    zoomRef.current = INITIAL_ZOOM;
    setZoom(INITIAL_ZOOM);
    setMessage('Choose a field to edit it.');
    setLoadError('');

    if (!toolbarContainer || !mountRef.current) {
      setState('error');
      setLoadError('The content-controls example could not be mounted.');
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
        onReady: () => {
          if (!isCurrent()) return;
          instance.ui.zoom.set(INITIAL_ZOOM.value);
          setState('ready');
        },
        onContentError: () => {
          if (!isCurrent()) return;
          teardown();
          setState('error');
          setLoadError('The content-controls document could not be read.');
        },
        onException: () => {
          if (!isCurrent()) return;
          setMessage('The editor reported a runtime error.');
        },
      });
      instanceRef.current = instance;

      const stopContentControls = instance.ui.contentControls.observe((snapshot) => {
        const catalogReadId = (catalogReadIdRef.current += 1);
        void Promise.resolve(instance.activeEditor?.doc?.contentControls?.list?.())
          .then((result) => {
            if (!result || !isCurrent() || catalogReadId !== catalogReadIdRef.current) return;
            applyContentControlsSnapshot({
              ...snapshot,
              status: 'ready',
              items: result.items,
              total: result.total,
            });
          })
          .catch(() => {
            if (isCurrent() && catalogReadId === catalogReadIdRef.current) applyContentControlsSnapshot(snapshot);
          });
      });
      const stopZoom = instance.ui.zoom.observe((snapshot) => {
        zoomRef.current = snapshot;
        if (isCurrent()) setZoom(snapshot);
      });
      observerCleanupRef.current = () => {
        stopContentControls();
        stopZoom();
      };

      instance.ui.contentControls.list();
      if (!isCurrent()) teardown();
    } catch (cause) {
      if (!isCurrent()) return;
      teardown();
      setState('error');
      setLoadError(cause instanceof Error ? cause.message : 'The content-controls example could not start.');
    }
  }, [applyContentControlsSnapshot, teardown]);

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

  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  function beginMutation(mutation: PendingMutation) {
    pendingMutationRef.current = mutation;
    setPendingMutation(mutation);
    setMessage(`Updating ${mutation.controlName}…`);
  }

  function failMutation(messageText: string) {
    pendingMutationRef.current = null;
    setPendingMutation(null);
    setMessage(messageText);
  }

  // The pinned 2.11 embed predates observer lease renewal. The source examples
  // rely on that fix; this compatibility read can go when the pin advances. A
  // refresh failure is not a mutation failure: the document already changed,
  // so the panel reports that and retries on the next observer emission.
  async function refreshPinnedRuntimeCatalog(instance: SuperDocInstance, mutation: PendingMutation) {
    let result:
      | Awaited<ReturnType<NonNullable<NonNullable<typeof instance.activeEditor>['doc']>['contentControls']['list']>>
      | undefined;
    try {
      result = await instance.activeEditor?.doc?.contentControls?.list?.();
    } catch {
      result = undefined;
    }
    if (!mountedRef.current || instanceRef.current !== instance) return;
    if (!result) {
      pendingMutationRef.current = null;
      setPendingMutation(null);
      if (mutation.kind === 'text') {
        setDrafts((current) => {
          const next = { ...current };
          delete next[mutation.controlId];
          return next;
        });
      }
      setMessage(`${successMessage(mutation)} The field list will refresh on the next change.`);
      return;
    }

    applyContentControlsSnapshot({
      ...instance.ui.contentControls.getSnapshot(),
      status: 'ready',
      items: result.items,
      total: result.total,
    });
  }

  async function showField(control: ContentControlInfo) {
    const instance = instanceRef.current;
    if (!instance || pendingMutation) return;

    let result = await instance.ui.contentControls.focus({ id: control.id });
    if (!result.success && result.reason === 'not-reachable' && control.selectionTarget) {
      const selectionResult = instance.ui.selection.apply(control.selectionTarget);
      const scrollResult = await instance.ui.contentControls.scrollIntoView({
        id: control.id,
        block: 'center',
      });
      if (selectionResult.ok && !scrollResult.success && mountRef.current) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        const geometry = instance.ui.viewport.getRect({
          target: control.selectionTarget,
          relativeTo: mountRef.current,
        });
        if (geometry.rect) {
          const top = mountRef.current.scrollTop + geometry.rect.top - mountRef.current.clientHeight / 2;
          mountRef.current.scrollTo({ top, behavior: 'smooth' });
          result = { success: true };
        }
      } else if (selectionResult.ok && scrollResult.success) {
        result = { success: true };
      }
    }
    if (!mountedRef.current || instanceRef.current !== instance) return;
    setMessage(
      result.success
        ? `Showing ${fieldName(control)} in the document.`
        : `${fieldName(control)} could not be shown in the document.`,
    );
  }

  async function updateTextField(control: ContentControlInfo, value: string) {
    const instance = instanceRef.current;
    const textControls = instance?.activeEditor?.doc?.contentControls?.text;
    if (!instance || !textControls?.setValue || pendingMutation) return;

    const mutation = { controlId: control.id, controlName: fieldName(control), kind: 'text', value } as const;
    beginMutation(mutation);
    try {
      const receipt = await textControls.setValue({ target: control.target, value });
      if (!mountedRef.current || instanceRef.current !== instance) return;
      if (!receipt.success) {
        failMutation(receipt.failure.message);
        return;
      }

      await refreshPinnedRuntimeCatalog(instance, mutation);
    } catch (error) {
      if (!mountedRef.current || instanceRef.current !== instance) return;
      failMutation(error instanceof Error ? error.message : `${fieldName(control)} could not be updated.`);
    }
  }

  async function updateCheckbox(control: ContentControlInfo, checked: boolean) {
    const instance = instanceRef.current;
    const checkboxes = instance?.activeEditor?.doc?.contentControls?.checkbox;
    if (!instance || !checkboxes?.setState || pendingMutation) return;

    const mutation = { checked, controlId: control.id, controlName: fieldName(control), kind: 'checkbox' } as const;
    beginMutation(mutation);
    try {
      const receipt = await checkboxes.setState({ target: control.target, checked });
      if (!mountedRef.current || instanceRef.current !== instance) return;
      if (!receipt.success) {
        failMutation(receipt.failure.message);
        return;
      }

      await refreshPinnedRuntimeCatalog(instance, mutation);
    } catch (error) {
      if (!mountedRef.current || instanceRef.current !== instance) return;
      failMutation(error instanceof Error ? error.message : `${fieldName(control)} could not be updated.`);
    }
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
    const node = rootRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement === node) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      // The inline demo remains usable when the browser refuses fullscreen.
    }
  }

  const controlsReady = state === 'ready';
  const fieldsReady = contentControls.status !== 'pending';
  const fitActive = zoom.mode === 'fit-width';

  return (
    <figure
      className='sd-custom-bold-demo sd-custom-content-controls-demo'
      data-custom-content-controls-demo
      data-state={state}
      ref={rootRef}
    >
      <div className='sd-custom-bold-demo-built-in sd-custom-content-controls-demo-built-in'>
        <div className='sd-custom-content-controls-demo-built-in-header'>
          <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
            SuperDoc UI
          </span>
          <EditorDemoViewControls
            disabled={!controlsReady}
            fitActive={fitActive}
            isFullscreen={isFullscreen}
            onFit={fitToWidth}
            onFullscreen={() => void toggleFullscreen()}
            onZoom={changeZoom}
            zoom={zoom}
          />
        </div>
        <div className='sd-custom-bold-demo-built-in-toolbar' ref={builtInToolbarRef} />
      </div>

      <CollapsibleEditorPreview
        className='sd-custom-content-controls-demo-preview'
        contentClassName='sd-custom-content-controls-demo-workspace'
        defaultExpanded
        expandedMaxHeight='72rem'
        onCollapse={() => mountRef.current?.scrollTo({ top: 0 })}
      >
        <div className='sd-custom-content-controls-demo-document'>
          {loadError ? (
            <div className='sd-custom-bold-demo-error' role='alert'>
              <p>{loadError}</p>
              <button onClick={() => void start()} type='button'>
                Try again
              </button>
            </div>
          ) : null}
          <div className='sd-custom-bold-demo-canvas sd-custom-content-controls-demo-canvas' ref={mountRef} />
        </div>

        <aside className='sd-custom-content-controls-demo-panel' aria-labelledby='custom-content-controls-demo-heading'>
          <header>
            <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
              Your application
            </span>
            <div>
              <h3 id='custom-content-controls-demo-heading'>Document fields</h3>
              <p>{fieldsReady ? fieldCountLabel(contentControls.total) : 'Loading fields…'}</p>
            </div>
            <button
              aria-label='Reset content-controls example'
              className='sd-custom-content-controls-demo-reset'
              disabled={state === 'loading'}
              onClick={() => void start()}
              type='button'
            >
              <RotateCcw aria-hidden='true' size={14} />
              Reset
            </button>
          </header>

          <ul className='sd-custom-content-controls-demo-list'>
            {contentControls.items.map((control) => {
              const name = fieldName(control);
              const locked = isContentLocked(control);
              const active = contentControls.activeIds.includes(control.id);
              const draft = drafts[control.id] ?? control.text ?? '';
              const checked =
                pendingMutation?.kind === 'checkbox' && pendingMutation.controlId === control.id
                  ? pendingMutation.checked
                  : (control.properties.checked ?? false);

              return (
                <li aria-current={active ? 'true' : undefined} key={control.id}>
                  <div className='sd-custom-content-controls-demo-meta'>
                    <strong>{name}</strong>
                    <span>{fieldTypeLabel(control)}</span>
                  </div>

                  <button
                    disabled={!controlsReady || pendingMutation !== null}
                    onClick={() => void showField(control)}
                    type='button'
                  >
                    {active ? 'Showing' : 'Show in document'}
                  </button>

                  {control.controlType === 'text' ? (
                    <div className='sd-custom-content-controls-demo-text-field'>
                      <label htmlFor={`custom-content-controls-${control.id}`}>Value</label>
                      <input
                        disabled={locked || pendingMutation !== null}
                        id={`custom-content-controls-${control.id}`}
                        onChange={(event) => setDrafts((current) => ({ ...current, [control.id]: event.target.value }))}
                        type='text'
                        value={draft}
                      />
                      <button
                        disabled={locked || pendingMutation !== null || draft === (control.text ?? '')}
                        onClick={() => void updateTextField(control, draft)}
                        type='button'
                      >
                        {pendingMutation?.kind === 'text' && pendingMutation.controlId === control.id
                          ? 'Updating…'
                          : 'Update'}
                      </button>
                    </div>
                  ) : null}

                  {control.controlType === 'checkbox' ? (
                    <label className='sd-custom-content-controls-demo-checkbox'>
                      <input
                        checked={checked}
                        disabled={locked || pendingMutation !== null}
                        onChange={(event) => void updateCheckbox(control, event.target.checked)}
                        type='checkbox'
                      />
                      Approved
                    </label>
                  ) : null}

                  {locked ? <small>Contents locked in the DOCX</small> : null}
                </li>
              );
            })}
          </ul>

          <output className='sd-custom-content-controls-demo-status' aria-live='polite'>
            {message}
          </output>
        </aside>
      </CollapsibleEditorPreview>
    </figure>
  );
}
