'use client';

import { MessageSquarePlus } from 'lucide-react';
import { type FormEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { UIConfig } from 'superdoc';
import type {
  CommentInfo,
  CommentsSlice,
  SelectionCapture,
  SelectionSlice,
  WorkflowReceipt,
  ZoomSlice,
} from 'superdoc/ui';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { EDITOR_DEMO_FIT_WIDTH_PADDING, fitRuntimeEditorToWidth } from './editor-demo-zoom';
import { createRuntimeEditor, loadRuntime, type SuperDocInstance } from './superdoc-runtime';

const DEMO_DOCUMENT = '/fixtures/custom-comments-workflow.docx';
const INITIAL_ZOOM = { max: 200, min: 10, mode: 'manual', value: 80 } satisfies ZoomSlice;
const INITIAL_COMMENTS = {
  status: 'pending',
  listStatus: 'pending',
  items: [],
  total: 0,
  activeIds: [],
  activeId: null,
} satisfies CommentsSlice;
const INITIAL_SELECTION = {
  status: 'pending',
  empty: true,
  target: null,
  selectionTarget: null,
  activeMarks: [],
  activeCommentIds: [],
  activeChangeIds: [],
  quotedText: '',
} satisfies SelectionSlice;

type DemoState = 'idle' | 'loading' | 'ready' | 'error';

function threadLabel(count: number) {
  return `${count} ${count === 1 ? 'thread' : 'threads'}`;
}

export function CustomCommentsDemo() {
  const rootRef = useRef<HTMLElement>(null);
  const builtInToolbarRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const startCommentRef = useRef<HTMLButtonElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const observerCleanupRef = useRef<(() => void) | null>(null);
  const pressedCaptureRef = useRef<SelectionCapture | null>(null);
  const restoreFocusRef = useRef(false);
  const loadIdRef = useRef(0);
  const mountedRef = useRef(true);
  const zoomRef = useRef<ZoomSlice>(INITIAL_ZOOM);

  const [state, setState] = useState<DemoState>('idle');
  const [commentState, setCommentState] = useState<CommentsSlice>(INITIAL_COMMENTS);
  const [selection, setSelection] = useState<SelectionSlice>(INITIAL_SELECTION);
  const [capture, setCapture] = useState<SelectionCapture | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState<ZoomSlice>(INITIAL_ZOOM);
  const [message, setMessage] = useState('Select text in the document to start a thread.');
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
    setCommentState(INITIAL_COMMENTS);
    setSelection(INITIAL_SELECTION);
    setCapture(null);
    setDraft('');
    setCreating(false);
    setPendingThreadId(null);
    zoomRef.current = INITIAL_ZOOM;
    setZoom(INITIAL_ZOOM);
    setMessage('Select text in the document to start a thread.');
    setLoadError('');

    if (!toolbarContainer || !mountRef.current) {
      setState('error');
      setLoadError('The comments example could not be mounted.');
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
          setLoadError('The comments document could not be read.');
        },
        onException: () => {
          if (!isCurrent()) return;
          setMessage('The editor reported a runtime error.');
        },
      });
      instanceRef.current = instance;

      const stopComments = instance.ui.comments.observe((snapshot) => {
        if (isCurrent()) setCommentState(snapshot);
      });
      const stopSelection = instance.ui.selection.observe((snapshot) => {
        if (isCurrent()) setSelection(snapshot);
      });
      const stopZoom = instance.ui.zoom.observe((snapshot) => {
        zoomRef.current = snapshot;
        if (isCurrent()) setZoom(snapshot);
      });
      observerCleanupRef.current = () => {
        stopComments();
        stopSelection();
        stopZoom();
      };

      if (!isCurrent()) teardown();
    } catch (cause) {
      if (!isCurrent()) return;
      teardown();
      setState('error');
      setLoadError(cause instanceof Error ? cause.message : 'The comments example could not start.');
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

  useEffect(() => {
    if (capture || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    startCommentRef.current?.focus();
  }, [capture]);

  function captureSelection() {
    pressedCaptureRef.current = instanceRef.current?.ui.selection.capture() ?? null;
  }

  function openComposer(event: ReactMouseEvent<HTMLButtonElement>) {
    const ui = instanceRef.current?.ui;
    const nextCapture =
      event.detail === 0
        ? (ui?.selection.capture() ?? null)
        : (pressedCaptureRef.current ?? ui?.selection.capture() ?? null);
    pressedCaptureRef.current = null;

    if (!nextCapture) {
      setMessage('Select text before starting a comment.');
      return;
    }

    setCapture(nextCapture);
    setMessage('Write the comment, then add it to the selected text.');
  }

  function closeComposer() {
    restoreFocusRef.current = true;
    pressedCaptureRef.current = null;
    setCapture(null);
    setDraft('');
  }

  async function createComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ui = instanceRef.current?.ui;
    if (!ui || !capture || creating || draft.trim().length === 0) return;

    const submittedCapture = capture;
    setCreating(true);
    const receipt = await ui.comments.createFromCapture(submittedCapture, { text: draft.trim() });
    if (!mountedRef.current) return;
    setCreating(false);

    if (receipt.success) {
      setMessage('Comment added to the selected text.');
      closeComposer();
    } else {
      setMessage(receipt.failure.message);
    }
  }

  async function showThread(commentId: string) {
    const commentsHandle = instanceRef.current?.ui.comments;
    if (!commentsHandle?.setActive(commentId)) {
      setMessage('That comment is no longer available.');
      return;
    }

    const result = await commentsHandle.scrollTo(commentId);
    if (!mountedRef.current) return;
    setMessage(
      result.success ? 'Showing the comment in the document.' : (result.reason ?? 'The comment could not be shown.'),
    );
  }

  async function toggleThreadStatus(thread: CommentInfo) {
    const commentsHandle = instanceRef.current?.ui.comments;
    if (!commentsHandle || pendingThreadId) return;

    setPendingThreadId(thread.id);
    const receipt: Awaited<WorkflowReceipt> = await (thread.status === 'resolved'
      ? commentsHandle.reopen(thread.id)
      : commentsHandle.resolve(thread.id));
    if (!mountedRef.current) return;
    setPendingThreadId(null);
    setMessage(
      receipt.success
        ? thread.status === 'resolved'
          ? 'Comment reopened.'
          : 'Comment resolved.'
        : receipt.failure.message,
    );
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

  const threads = commentState.items.filter((comment) => !comment.parentCommentId);
  const controlsReady = state === 'ready';
  const fitActive = zoom.mode === 'fit-width';

  return (
    <figure
      className='sd-custom-bold-demo sd-custom-comments-demo'
      data-custom-comments-demo
      data-state={state}
      ref={rootRef}
    >
      <div className='sd-custom-bold-demo-built-in sd-custom-comments-demo-built-in'>
        <div className='sd-custom-comments-demo-built-in-header'>
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
        className='sd-custom-comments-demo-preview'
        contentClassName='sd-custom-comments-demo-workspace'
        defaultExpanded
        expandedMaxHeight='80rem'
        onCollapse={() => mountRef.current?.scrollTo({ top: 0 })}
      >
        <div className='sd-custom-comments-demo-document'>
          {loadError ? (
            <div className='sd-custom-bold-demo-error' role='alert'>
              <p>{loadError}</p>
              <button onClick={() => void start()} type='button'>
                Try again
              </button>
            </div>
          ) : null}
          <div className='sd-custom-bold-demo-canvas sd-custom-comments-demo-canvas' ref={mountRef} />
        </div>

        <aside className='sd-custom-comments-demo-panel' aria-labelledby='custom-comments-demo-heading'>
          <header>
            <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
              Your application
            </span>
            <h3 id='custom-comments-demo-heading'>Comments</h3>
            <p>{commentState.listStatus === 'pending' ? 'Loading comments…' : threadLabel(threads.length)}</p>
          </header>

          <button
            className='sd-custom-comments-demo-start'
            disabled={!controlsReady || selection.empty || capture !== null}
            onClick={openComposer}
            onMouseDown={captureSelection}
            ref={startCommentRef}
            type='button'
          >
            <MessageSquarePlus aria-hidden='true' size={16} />
            Comment on selection
          </button>

          {capture ? (
            <form className='sd-custom-comments-demo-composer' onSubmit={(event) => void createComment(event)}>
              <label htmlFor='custom-comments-demo-text'>New comment</label>
              {capture.quotedText ? <p className='sd-custom-comments-demo-quote'>“{capture.quotedText}”</p> : null}
              <textarea
                autoFocus
                disabled={creating}
                id='custom-comments-demo-text'
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                value={draft}
              />
              <div>
                <button disabled={creating || draft.trim().length === 0} type='submit'>
                  {creating ? 'Adding…' : 'Add comment'}
                </button>
                <button disabled={creating} onClick={closeComposer} type='button'>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          <ul className='sd-custom-comments-demo-list'>
            {threads.map((thread) => (
              <li aria-current={thread.id === commentState.activeId ? 'true' : undefined} key={thread.address.entityId}>
                <div>
                  <strong>{thread.creatorName ?? 'Document author'}</strong>
                  <span>{thread.status}</span>
                </div>
                <p>{thread.text || 'Comment without text'}</p>
                <div>
                  <button onClick={() => void showThread(thread.id)} type='button'>
                    Show in document
                  </button>
                  <button
                    disabled={pendingThreadId !== null}
                    onClick={() => void toggleThreadStatus(thread)}
                    type='button'
                  >
                    {pendingThreadId === thread.id ? 'Updating…' : thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <output className='sd-custom-comments-demo-status' aria-live='polite'>
            {message}
          </output>
        </aside>
      </CollapsibleEditorPreview>
    </figure>
  );
}
