'use client';

import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIConfig } from 'superdoc';
import type { SearchSnapshot, WorkflowActionResult, ZoomSlice } from 'superdoc/ui';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { EDITOR_DEMO_FIT_WIDTH_PADDING, fitRuntimeEditorToWidth } from './editor-demo-zoom';
import { createRuntimeEditor, loadRuntime, type SuperDocInstance } from './superdoc-runtime';

const DEMO_DOCUMENT = '/fixtures/search-sample.docx';
const DEFAULT_QUERY = 'Client';
const DEFAULT_REPLACEMENT = 'Customer';
const NARROW_DEMO_WIDTH = 520;
const INITIAL_ZOOM = { max: 200, min: 10, mode: 'manual', value: 80 } satisfies ZoomSlice;
const INITIAL_SEARCH = {
  query: '',
  total: 0,
  activeIndex: -1,
  open: false,
  available: false,
  caseSensitive: false,
  includeTrackedDeletions: false,
  includeDeletedText: false,
  regex: false,
  canReplace: false,
  canReplaceAll: false,
} satisfies SearchSnapshot;

type DemoState = 'idle' | 'loading' | 'ready' | 'error';

function matchCountLabel(snapshot: SearchSnapshot) {
  if (snapshot.total === 0) return 'No matches';
  if (snapshot.activeIndex < 0) return `${snapshot.total} matches`;
  return `${snapshot.activeIndex + 1} of ${snapshot.total}`;
}

function searchStatus(snapshot: SearchSnapshot, query: string, state: DemoState) {
  if (state === 'error') return 'Search could not start.';
  if (state !== 'ready') return 'Loading Search…';
  if (!snapshot.available) return 'Search is unavailable for this document.';
  if (!query) return 'Enter text to find it in the document.';
  if (snapshot.reason === 'search-invalid-pattern') return 'Check the search pattern and try again.';
  if (snapshot.total === 0) return `No matches for “${query}”.`;
  return `${snapshot.total} ${snapshot.total === 1 ? 'match' : 'matches'} highlighted in the document.`;
}

export function CustomSearchDemo() {
  const rootRef = useRef<HTMLElement>(null);
  const builtInToolbarRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const observerCleanupRef = useRef<(() => void) | null>(null);
  const loadIdRef = useRef(0);
  const mountedRef = useRef(true);
  const zoomRef = useRef<ZoomSlice>(INITIAL_ZOOM);

  const [state, setState] = useState<DemoState>('idle');
  const [searchSnapshot, setSearchSnapshot] = useState<SearchSnapshot>(INITIAL_SEARCH);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [replacement, setReplacement] = useState(DEFAULT_REPLACEMENT);
  const [matchCase, setMatchCase] = useState(false);
  const [replacementPending, setReplacementPending] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState<ZoomSlice>(INITIAL_ZOOM);

  const teardown = useCallback(() => {
    observerCleanupRef.current?.();
    observerCleanupRef.current = null;
    instanceRef.current?.ui.search.close();
    instanceRef.current?.destroy();
    instanceRef.current = null;
  }, []);

  const start = useCallback(async () => {
    const loadId = (loadIdRef.current += 1);
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
    const toolbarContainer = builtInToolbarRef.current;

    teardown();
    setState('loading');
    setSearchSnapshot(INITIAL_SEARCH);
    setQuery(DEFAULT_QUERY);
    setReplacement(DEFAULT_REPLACEMENT);
    setMatchCase(false);
    setReplacementPending(false);
    setMessage('');
    setLoadError('');
    zoomRef.current = INITIAL_ZOOM;
    setZoom(INITIAL_ZOOM);

    if (!toolbarContainer || !mountRef.current) {
      setState('error');
      setLoadError('The Search example could not be mounted.');
      return;
    }

    try {
      const SuperDocCtor = await loadRuntime();
      if (!isCurrent() || !mountRef.current) return;

      const editorUi = {
        comments: false,
        loading: false,
        search: false,
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
          if ((rootRef.current?.clientWidth ?? NARROW_DEMO_WIDTH) < NARROW_DEMO_WIDTH) {
            instance.ui.zoom.setMode('fit-width');
          } else {
            instance.ui.zoom.set(INITIAL_ZOOM.value);
          }
          setState('ready');
          setSearchSnapshot(instance.ui.search.find(DEFAULT_QUERY));
        },
        onContentError: () => {
          if (!isCurrent()) return;
          teardown();
          setState('error');
          setLoadError('The Search document could not be read.');
        },
        onException: () => {
          if (!isCurrent()) return;
          setMessage('The editor reported a runtime error.');
        },
      });
      instanceRef.current = instance;

      const stopSearch = instance.ui.search.observe((snapshot) => {
        if (isCurrent()) setSearchSnapshot(snapshot);
      });
      const stopZoom = instance.ui.zoom.observe((snapshot) => {
        zoomRef.current = snapshot;
        if (isCurrent()) setZoom(snapshot);
      });
      observerCleanupRef.current = () => {
        stopSearch();
        stopZoom();
      };

      if (!isCurrent()) teardown();
    } catch (cause) {
      if (!isCurrent()) return;
      teardown();
      setState('error');
      setLoadError(cause instanceof Error ? cause.message : 'The Search example could not start.');
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

  function find(nextQuery: string, caseSensitive = matchCase) {
    setQuery(nextQuery);
    setMessage('');

    const search = instanceRef.current?.ui.search;
    if (!search) return;
    if (!nextQuery) {
      search.clear();
      return;
    }
    setSearchSnapshot(search.find(nextQuery, { caseSensitive }));
  }

  function changeMatchCase(checked: boolean) {
    setMatchCase(checked);
    find(query, checked);
  }

  function report(result: WorkflowActionResult) {
    if (!result.ok) setMessage('Search could not move to that match.');
    else setMessage('');
  }

  function goPrevious() {
    const search = instanceRef.current?.ui.search;
    if (search) report(search.previous());
  }

  function goNext() {
    const search = instanceRef.current?.ui.search;
    if (search) report(search.next());
  }

  async function replaceCurrent() {
    const search = instanceRef.current?.ui.search;
    if (!search || replacementPending) return;

    setReplacementPending(true);
    setMessage('Replacing the active match…');
    try {
      const result = await search.replace(replacement);
      if (!mountedRef.current || instanceRef.current?.ui.search !== search) return;
      setMessage(result.ok ? 'Replaced the active match.' : (result.reason ?? 'The match could not be replaced.'));
    } catch {
      if (mountedRef.current && instanceRef.current?.ui.search === search) {
        setMessage('The match could not be replaced.');
      }
    } finally {
      if (mountedRef.current && instanceRef.current?.ui.search === search) setReplacementPending(false);
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

  const controlsReady = state === 'ready' && searchSnapshot.available;
  const hasMatches = searchSnapshot.total > 0;
  const status = message || searchStatus(searchSnapshot, query, state);
  const fitActive = zoom.mode === 'fit-width';

  return (
    <figure
      className='sd-custom-bold-demo sd-custom-search-demo'
      data-custom-search-demo
      data-state={state}
      ref={rootRef}
    >
      <div className='sd-custom-bold-demo-built-in sd-custom-search-demo-built-in'>
        <div className='sd-custom-search-demo-built-in-header'>
          <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
            SuperDoc UI
          </span>
          <EditorDemoViewControls
            disabled={state !== 'ready'}
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
        className='sd-custom-search-demo-preview'
        contentClassName='sd-custom-search-demo-workspace'
        defaultExpanded
        expandedMaxHeight='72rem'
        onCollapse={() => mountRef.current?.scrollTo({ top: 0 })}
      >
        <div className='sd-custom-search-demo-document'>
          {loadError ? (
            <div className='sd-custom-bold-demo-error' role='alert'>
              <p>{loadError}</p>
              <button onClick={() => void start()} type='button'>
                Try again
              </button>
            </div>
          ) : null}
          <div className='sd-custom-bold-demo-canvas sd-custom-search-demo-canvas' ref={mountRef} />
        </div>

        <aside className='sd-custom-search-demo-panel' aria-labelledby='custom-search-demo-heading'>
          <header>
            <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
              Your application
            </span>
            <div>
              <h3 id='custom-search-demo-heading'>Find in document</h3>
              <p>Application-owned Search</p>
            </div>
            <button
              aria-label='Reset Search example'
              className='sd-custom-search-demo-reset'
              disabled={state === 'loading'}
              onClick={() => void start()}
              type='button'
            >
              <RotateCcw aria-hidden='true' size={14} />
              Reset
            </button>
          </header>

          <form onSubmit={(event) => event.preventDefault()} role='search'>
            <label className='sd-custom-search-demo-field' htmlFor='custom-search-demo-query'>
              Find
              <input
                disabled={!controlsReady || replacementPending}
                id='custom-search-demo-query'
                onChange={(event) => find(event.target.value)}
                type='search'
                value={query}
              />
            </label>

            <label className='sd-custom-search-demo-checkbox'>
              <input
                checked={matchCase}
                disabled={!controlsReady || replacementPending}
                onChange={(event) => changeMatchCase(event.target.checked)}
                type='checkbox'
              />
              Match case
            </label>

            <div aria-label='Search result navigation' className='sd-custom-search-demo-navigation' role='group'>
              <button disabled={!controlsReady || !hasMatches || replacementPending} onClick={goPrevious} type='button'>
                <ChevronLeft aria-hidden='true' size={14} />
                Previous
              </button>
              <output aria-live='polite'>{matchCountLabel(searchSnapshot)}</output>
              <button disabled={!controlsReady || !hasMatches || replacementPending} onClick={goNext} type='button'>
                Next
                <ChevronRight aria-hidden='true' size={14} />
              </button>
            </div>

            <label className='sd-custom-search-demo-field' htmlFor='custom-search-demo-replacement'>
              Replace with
              <input
                disabled={!controlsReady || replacementPending}
                id='custom-search-demo-replacement'
                onChange={(event) => setReplacement(event.target.value)}
                type='text'
                value={replacement}
              />
            </label>

            <button
              className='sd-custom-search-demo-replace'
              disabled={!controlsReady || !hasMatches || !searchSnapshot.canReplace || replacementPending}
              onClick={() => void replaceCurrent()}
              type='button'
            >
              {replacementPending ? 'Replacing…' : 'Replace active match'}
            </button>
          </form>

          <output className='sd-custom-search-demo-status' aria-live='polite'>
            {status}
          </output>
        </aside>
      </CollapsibleEditorPreview>
    </figure>
  );
}
