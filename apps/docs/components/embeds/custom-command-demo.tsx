'use client';

import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { UIConfig } from 'superdoc';
import type { CommandExecutionResult, CustomCommandHandle, CustomCommandHandleState, ZoomSlice } from 'superdoc/ui';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { CUSTOM_COMMAND_SHORTCUT, matchesCustomCommandShortcut } from './custom-command-shortcut';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { EDITOR_DEMO_FIT_WIDTH_PADDING, fitRuntimeEditorToWidth } from './editor-demo-zoom';
import { createRuntimeEditor, loadRuntime, type SuperDocInstance } from './superdoc-runtime';

const DEMO_DOCUMENT = '/fixtures/getting-started.docx';
const COMMAND_ID = 'application.insertClause';
const CLAUSE_TEXT = ' This agreement is governed by the laws of California.';
const NARROW_DEMO_WIDTH = 520;
const INITIAL_ZOOM = { max: 200, min: 10, mode: 'manual', value: 80 } satisfies ZoomSlice;
const INITIAL_COMMAND_STATE = {
  active: false,
  disabled: true,
  enabled: false,
  source: 'unsupported',
  supported: false,
  value: undefined,
  reason: 'not-ready',
} satisfies CustomCommandHandleState;

type DemoState = 'idle' | 'loading' | 'ready' | 'error';
type CommandTrigger = 'button' | 'shortcut';
type InsertClausePayload = Readonly<{
  text: string;
  trigger: CommandTrigger;
}>;
function commandSucceeded(result: CommandExecutionResult) {
  return result === true || (typeof result === 'object' && result.success);
}

function commandFailureMessage(result: CommandExecutionResult) {
  if (result === false) return 'The command could not run.';
  if (typeof result === 'object' && !result.success) return result.failure?.message ?? 'The clause was not inserted.';
  return null;
}

function triggerLabel(trigger: CommandTrigger) {
  return trigger === 'button' ? 'Button' : 'Shortcut';
}

export function CustomCommandDemo() {
  const rootRef = useRef<HTMLElement>(null);
  const builtInToolbarRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const commandRef = useRef<CustomCommandHandle<InsertClausePayload> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const actionRef = useRef<symbol | null>(null);
  const loadIdRef = useRef(0);
  const readyRef = useRef(false);
  const mountedRef = useRef(true);
  const zoomRef = useRef<ZoomSlice>(INITIAL_ZOOM);

  const [state, setState] = useState<DemoState>('idle');
  const [commandState, setCommandState] = useState<CustomCommandHandleState>(INITIAL_COMMAND_STATE);
  const [message, setMessage] = useState('Place the caret in the document.');
  const [loadError, setLoadError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState<ZoomSlice>(INITIAL_ZOOM);

  const teardown = useCallback(() => {
    actionRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
    commandRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
  }, []);

  const runCommand = useCallback(async (trigger: CommandTrigger) => {
    const command = commandRef.current;
    const instance = instanceRef.current;
    if (!command || !instance || actionRef.current) return;

    const currentState = command.getState();
    if (!currentState.enabled) {
      setMessage(
        currentState.reason === 'document-readonly'
          ? 'Switch the document to editing mode first.'
          : 'Place the caret in the document first.',
      );
      return;
    }

    const action = Symbol();
    actionRef.current = action;
    setIsPending(true);
    setMessage(`${triggerLabel(trigger)} is running ${COMMAND_ID}…`);

    try {
      const result = await command.executeAsync({ text: CLAUSE_TEXT, trigger });
      if (!mountedRef.current || instanceRef.current !== instance || actionRef.current !== action) return;
      setMessage(
        commandSucceeded(result)
          ? `${triggerLabel(trigger)} ran ${COMMAND_ID}. Clause inserted.`
          : (commandFailureMessage(result) ?? 'The clause was not inserted.'),
      );
    } catch (cause) {
      if (mountedRef.current && instanceRef.current === instance && actionRef.current === action) {
        setMessage(cause instanceof Error ? cause.message : 'The clause was not inserted.');
      }
    } finally {
      if (actionRef.current === action) {
        actionRef.current = null;
        if (mountedRef.current && instanceRef.current === instance) setIsPending(false);
      }
    }
  }, []);

  const start = useCallback(async () => {
    const loadId = (loadIdRef.current += 1);
    readyRef.current = false;
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
    const toolbarContainer = builtInToolbarRef.current;

    teardown();
    setState('loading');
    setCommandState(INITIAL_COMMAND_STATE);
    setMessage('Loading the document…');
    setLoadError('');
    setIsPending(false);
    zoomRef.current = INITIAL_ZOOM;
    setZoom(INITIAL_ZOOM);

    if (!toolbarContainer || !mountRef.current) {
      setState('error');
      setLoadError('The command example could not be mounted.');
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
          setMessage('Place the caret, then use the button or shortcut.');
        },
        onContentError: () => {
          if (!isCurrent()) return;
          // `onContentError` covers failures while reading *or updating* a document, so it can
          // fire after onReady with the reader's edits in the session. Only a failure to open
          // justifies destroying it.
          if (readyRef.current) {
            setMessage('The editor could not apply that change. Your edits are still here.');
            return;
          }
          teardown();
          setState('error');
          setLoadError('The command document could not be read.');
        },
        onException: () => {
          if (!isCurrent()) return;
          setMessage('The editor reported a runtime error.');
        },
      });
      instanceRef.current = instance;

      const registration = instance.ui.commands.register<InsertClausePayload>({
        id: COMMAND_ID,
        shortcut: CUSTOM_COMMAND_SHORTCUT,
        getState: ({ documentMode, selection, state: uiState }) => {
          const settled = uiState.ready && selection.status === 'ready';
          // A settled read still reports both targets as null until the reader places a caret,
          // and an insert at a non-collapsed range degrades to a replace in the adapter
          // (document-api-v2-adapter selection-mutation/adapter.ts:349-363), which would delete
          // the reader's selection instead of inserting the clause.
          const hasCaret = Boolean(selection.selectionTarget ?? selection.target) && selection.empty;
          return {
            enabled: settled && hasCaret && documentMode !== 'viewing',
            active: false,
            supported: true,
            reason: !settled
              ? 'not-ready'
              : !hasCaret
                ? 'selection-required'
                : documentMode === 'viewing'
                  ? 'document-readonly'
                  : undefined,
          };
        },
        execute: ({ insertText, payload }) => (payload?.text ? insertText(payload.text) : false),
      });
      commandRef.current = registration.handle;
      setCommandState(registration.handle.getState());

      const stopCommandState = registration.handle.observe((snapshot) => {
        if (isCurrent()) setCommandState(snapshot);
      });
      const stopZoom = instance.ui.zoom.observe((snapshot) => {
        zoomRef.current = snapshot;
        if (isCurrent()) setZoom(snapshot);
      });
      const runShortcut = (event: KeyboardEvent) => {
        if (!rootRef.current || !event.composedPath().includes(rootRef.current)) return;
        if (event.repeat) return;
        if (!matchesCustomCommandShortcut(event)) return;
        event.preventDefault();
        void runCommand('shortcut');
      };
      window.addEventListener('keydown', runShortcut, true);
      cleanupRef.current = () => {
        window.removeEventListener('keydown', runShortcut, true);
        stopCommandState();
        stopZoom();
        registration.unregister();
      };

      if (!isCurrent()) teardown();
    } catch (cause) {
      if (!isCurrent()) return;
      teardown();
      setState('error');
      setLoadError(cause instanceof Error ? cause.message : 'The command example could not start.');
    }
  }, [runCommand, teardown]);

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

  function preserveSelection(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
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

  return (
    <figure
      className='sd-custom-bold-demo sd-custom-command-demo'
      data-custom-command-demo
      data-state={state}
      ref={rootRef}
    >
      <div className='sd-custom-bold-demo-built-in'>
        <div className='sd-custom-command-demo-built-in-header'>
          <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
            SuperDoc UI
          </span>
          <EditorDemoViewControls
            disabled={!controlsReady}
            fitActive={zoom.mode === 'fit-width'}
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
        className='sd-custom-command-demo-preview'
        contentClassName='sd-custom-command-demo-workspace'
        defaultExpanded
        onCollapse={() => mountRef.current?.scrollTo({ top: 0 })}
      >
        <div
          className='sd-custom-bold-demo-toolbar sd-custom-command-demo-controls'
          role='toolbar'
          aria-label='Application actions'
        >
          <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
            Your application
          </span>
          <button
            aria-keyshortcuts='Control+Shift+Y'
            disabled={!controlsReady || isPending || !commandState.enabled}
            onClick={() => void runCommand('button')}
            onMouseDown={preserveSelection}
            title={commandState.reason ?? 'Insert standard clause'}
            type='button'
          >
            <Plus aria-hidden='true' size={16} />
            {isPending ? 'Inserting…' : 'Insert clause'}
          </button>
          <kbd>Ctrl Shift Y</kbd>
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
        <div className='sd-custom-bold-demo-canvas sd-custom-command-demo-canvas' ref={mountRef} />
      </CollapsibleEditorPreview>
    </figure>
  );
}
