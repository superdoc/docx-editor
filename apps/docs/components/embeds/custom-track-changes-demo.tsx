'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIConfig } from 'superdoc';
import type { TrackChangesItem, TrackChangesSlice, ZoomSlice } from 'superdoc/ui';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { EDITOR_DEMO_FIT_WIDTH_PADDING, fitRuntimeEditorToWidth } from './editor-demo-zoom';
import { createRuntimeEditor, loadRuntime, type SuperDocInstance } from './superdoc-runtime';

const DEMO_DOCUMENT = '/fixtures/custom-track-changes-workflow.docx';
const INITIAL_ZOOM = { max: 200, min: 10, mode: 'manual', value: 80 } satisfies ZoomSlice;
const INITIAL_TRACK_CHANGES = {
  status: 'pending',
  items: [],
  total: 0,
  activeId: null,
  authors: [],
} satisfies TrackChangesSlice;

type DemoState = 'idle' | 'loading' | 'ready' | 'error';
type Decision = 'accept' | 'reject';
type PendingDecision = { key: string; decision: Decision };
type ActiveRow = { id: string; key: string };

function changeCountLabel(count: number) {
  return `${count} open ${count === 1 ? 'change' : 'changes'}`;
}

function changeKind(change: TrackChangesItem) {
  if (change.insertedText && change.deletedText) return 'Replacement';
  if (change.insertedText) return 'Insertion';
  if (change.deletedText) return 'Deletion';
  if (change.formattingDeltaSummary) return 'Formatting';
  return 'Change';
}

function changeText(change: TrackChangesItem) {
  return (
    change.insertedText ??
    change.deletedText ??
    change.excerpt ??
    change.formattingDeltaSummary ??
    change.subtype ??
    change.type
  );
}

/** A row's exact occurrence: the id plus its story when the change is outside the body. */
function decisionTarget(change: TrackChangesItem): { id: string; story?: unknown } {
  const story = change.address?.story;
  return story ? { id: change.id, story } : { id: change.id };
}

/** Stable per-occurrence key. The same id can appear in the body and in a footnote or header. */
function rowKey(change: TrackChangesItem): string {
  return `${change.id}:${JSON.stringify(change.address?.story ?? null)}`;
}

/** Whether this row is the active occurrence, not merely a row sharing the active id. */
function isActiveRow(change: TrackChangesItem, activeId: string | null, activeRow: ActiveRow | null): boolean {
  if (change.id !== activeId) return false;
  return activeRow === null || activeRow.id !== activeId || activeRow.key === rowKey(change);
}

export function CustomTrackChangesDemo() {
  const rootRef = useRef<HTMLElement>(null);
  const builtInToolbarRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const observerCleanupRef = useRef<(() => void) | null>(null);
  const loadIdRef = useRef(0);
  const mountedRef = useRef(true);
  const zoomRef = useRef<ZoomSlice>(INITIAL_ZOOM);

  const [state, setState] = useState<DemoState>('idle');
  const [trackChanges, setTrackChanges] = useState<TrackChangesSlice>(INITIAL_TRACK_CHANGES);
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  // The occurrence this panel focused. `activeId` alone cannot tell a body row
  // from a same-id footnote or header row, so the panel remembers which one it
  // asked for and only trusts it while the controller still reports that id.
  const [activeRow, setActiveRow] = useState<ActiveRow | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState<ZoomSlice>(INITIAL_ZOOM);
  const [message, setMessage] = useState('Choose a change to review it.');
  const [loadError, setLoadError] = useState('');

  const teardown = useCallback(() => {
    observerCleanupRef.current?.();
    observerCleanupRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
  }, []);

  const start = useCallback(async () => {
    const loadId = (loadIdRef.current += 1);
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
    const toolbarContainer = builtInToolbarRef.current;

    teardown();
    setState('loading');
    setTrackChanges(INITIAL_TRACK_CHANGES);
    setPendingDecision(null);
    setActiveRow(null);
    zoomRef.current = INITIAL_ZOOM;
    setZoom(INITIAL_ZOOM);
    setMessage('Choose a change to review it.');
    setLoadError('');

    if (!toolbarContainer || !mountRef.current) {
      setState('error');
      setLoadError('The tracked-changes example could not be mounted.');
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
        documentMode: 'suggesting',
        ui: editorUi,
        user: { name: 'Alex Rivera', email: 'alex@example.com' },
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
          setLoadError('The tracked-changes document could not be read.');
        },
        onException: () => {
          if (!isCurrent()) return;
          setMessage('The editor reported a runtime error.');
        },
      });
      instanceRef.current = instance;

      const stopTrackChanges = instance.ui.trackChanges.observe((snapshot) => {
        if (isCurrent()) setTrackChanges(snapshot);
      });
      const stopZoom = instance.ui.zoom.observe((snapshot) => {
        zoomRef.current = snapshot;
        if (isCurrent()) setZoom(snapshot);
      });
      observerCleanupRef.current = () => {
        stopTrackChanges();
        stopZoom();
      };

      if (!isCurrent()) teardown();
    } catch (cause) {
      if (!isCurrent()) return;
      teardown();
      setState('error');
      setLoadError(cause instanceof Error ? cause.message : 'The tracked-changes example could not start.');
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

  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  async function showChange(change: TrackChangesItem) {
    const instance = instanceRef.current;
    const trackChangesHandle = instance?.ui.trackChanges;
    // The row's { id, story } pins the clicked occurrence. The pinned runtime's
    // scrollTo takes a bare id and resolves the story from the loaded row.
    const target = decisionTarget(change);
    if (!trackChangesHandle?.setActive(target)) {
      setMessage('That tracked change is no longer available.');
      return;
    }
    setActiveRow({ id: change.id, key: rowKey(change) });

    const result = await trackChangesHandle.scrollTo(target.id);
    if (!mountedRef.current || instanceRef.current !== instance) return;
    setMessage(result.success ? 'Showing the change in the document.' : 'The tracked change could not be shown.');
  }

  async function navigate(direction: 'next' | 'previous') {
    const instance = instanceRef.current;
    const trackChangesHandle = instance?.ui.trackChanges;
    if (!trackChangesHandle || pendingDecision) return;
    // Navigation picks the occurrence, so the panel stops asserting its own.
    setActiveRow(null);

    const result =
      direction === 'next' ? await trackChangesHandle.navigateNext() : await trackChangesHandle.navigatePrevious();
    if (!mountedRef.current || instanceRef.current !== instance) return;
    setMessage(result.success ? `Showing the ${direction} change.` : 'No tracked change could be shown.');
  }

  async function decideChange(decision: Decision, change: TrackChangesItem) {
    const instance = instanceRef.current;
    if (!instance || pendingDecision) return;

    setPendingDecision({ key: rowKey(change), decision });
    setMessage(decision === 'accept' ? 'Accepting change…' : 'Rejecting change…');

    // The pinned runtime predates `acceptAsync()`, and its `executeAsync()`
    // waits on a fresh selection read before an id-scoped decision. So the demo
    // awaits the one Document API operation the controller's decision routes
    // to, which settles with the receipt and never consults the selection. The
    // snippets on this page use `acceptAsync()` / `rejectAsync()`, which await
    // the same operation on a current runtime.
    const doc = instance.activeEditor?.doc;
    if (!doc) {
      setPendingDecision(null);
      setMessage('The review decision is unavailable.');
      return;
    }
    // The row's address carries the typed story locator the Document API wants.
    const story = change.address?.story;
    let outcome: string;
    try {
      const receipt = await doc.trackChanges.decide({
        decision,
        target: story ? { kind: 'id', id: change.id, story } : { kind: 'id', id: change.id },
      });
      outcome = receipt.success
        ? decision === 'accept'
          ? 'Change accepted.'
          : 'Change rejected.'
        : receipt.failure.message;
    } catch (cause) {
      // A runtime or worker failure rejects instead of returning a receipt.
      outcome = cause instanceof Error ? cause.message : 'The review decision could not run.';
    }
    if (!mountedRef.current || instanceRef.current !== instance) return;

    setPendingDecision(null);
    setMessage(outcome);
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
  const changesReady = trackChanges.status !== 'pending';
  const fitActive = zoom.mode === 'fit-width';

  return (
    <figure
      className='sd-custom-bold-demo sd-custom-track-changes-demo'
      data-custom-track-changes-demo
      data-state={state}
      ref={rootRef}
    >
      <div className='sd-custom-bold-demo-built-in sd-custom-track-changes-demo-built-in'>
        <div className='sd-custom-track-changes-demo-built-in-header'>
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
        className='sd-custom-track-changes-demo-preview'
        contentClassName='sd-custom-track-changes-demo-workspace'
        defaultExpanded
        expandedMaxHeight='80rem'
        onCollapse={() => mountRef.current?.scrollTo({ top: 0 })}
      >
        <div className='sd-custom-track-changes-demo-document'>
          {loadError ? (
            <div className='sd-custom-bold-demo-error' role='alert'>
              <p>{loadError}</p>
              <button onClick={() => void start()} type='button'>
                Try again
              </button>
            </div>
          ) : null}
          <div className='sd-custom-bold-demo-canvas sd-custom-track-changes-demo-canvas' ref={mountRef} />
        </div>

        <aside className='sd-custom-track-changes-demo-panel' aria-labelledby='custom-track-changes-demo-heading'>
          <header>
            <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
              Your application
            </span>
            <h3 id='custom-track-changes-demo-heading'>Review changes</h3>
            <p>{changesReady ? changeCountLabel(trackChanges.total) : 'Loading changes…'}</p>
          </header>

          <div className='sd-custom-track-changes-demo-navigation' aria-label='Tracked change navigation'>
            <button
              disabled={!controlsReady || trackChanges.total === 0 || pendingDecision !== null}
              onClick={() => void navigate('previous')}
              type='button'
            >
              <ChevronLeft aria-hidden='true' size={15} />
              Previous
            </button>
            <button
              disabled={!controlsReady || trackChanges.total === 0 || pendingDecision !== null}
              onClick={() => void navigate('next')}
              type='button'
            >
              Next
              <ChevronRight aria-hidden='true' size={15} />
            </button>
          </div>

          {changesReady && trackChanges.total === 0 ? (
            <div className='sd-custom-track-changes-demo-empty'>
              <p>No open changes.</p>
              <button onClick={() => void start()} type='button'>
                Reset example
              </button>
            </div>
          ) : (
            <ul className='sd-custom-track-changes-demo-list'>
              {trackChanges.items.map((change) => {
                const kind = changeKind(change);
                const detail = changeText(change);
                const isPending = pendingDecision?.key === rowKey(change);
                const active = isActiveRow(change, trackChanges.activeId, activeRow);

                return (
                  <li aria-current={active ? 'true' : undefined} key={rowKey(change)}>
                    <div className='sd-custom-track-changes-demo-meta'>
                      <strong>{kind}</strong>
                      <span>{change.author ?? 'Document author'}</span>
                    </div>
                    <p>“{detail}”</p>
                    <div className='sd-custom-track-changes-demo-actions'>
                      <button disabled={pendingDecision !== null} onClick={() => void showChange(change)} type='button'>
                        {active ? 'Showing' : 'Show in document'}
                      </button>
                      <button
                        aria-label={`Accept ${kind.toLowerCase()}: ${detail}`}
                        disabled={pendingDecision !== null}
                        onClick={() => void decideChange('accept', change)}
                        type='button'
                      >
                        {isPending && pendingDecision.decision === 'accept' ? 'Accepting…' : 'Accept'}
                      </button>
                      <button
                        aria-label={`Reject ${kind.toLowerCase()}: ${detail}`}
                        disabled={pendingDecision !== null}
                        onClick={() => void decideChange('reject', change)}
                        type='button'
                      >
                        {isPending && pendingDecision.decision === 'reject' ? 'Rejecting…' : 'Reject'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <output className='sd-custom-track-changes-demo-status' aria-live='polite'>
            {message}
          </output>
        </aside>
      </CollapsibleEditorPreview>
    </figure>
  );
}
