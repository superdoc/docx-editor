'use client';

import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SurfaceHandle, ThemeConfig, UIConfig } from 'superdoc';
import type { ZoomSlice } from 'superdoc/ui';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { EDITOR_DEMO_FIT_WIDTH_PADDING, fitRuntimeEditorToWidth } from './editor-demo-zoom';
import { createRuntimeEditor, loadRuntime, type SuperDocConstructor, type SuperDocInstance } from './superdoc-runtime';

const DEMO_DOCUMENT = '/fixtures/getting-started.docx';
const THEME_NAME = 'docs-playground';
const NARROW_DEMO_WIDTH = 520;
const INITIAL_ZOOM = { max: 200, min: 10, mode: 'manual', value: 80 } satisfies ZoomSlice;

type DemoState = 'idle' | 'loading' | 'ready' | 'error';
type ThemePresetId = 'default' | 'product';

type ThemeDraft = Readonly<{
  action: string;
  border: string;
  radius: string;
  surface: string;
  text: string;
  overrideToolbarBackground: boolean;
  toolbarBackground: string;
}>;

const presets = {
  default: {
    action: '#1355ff',
    border: '#dbdbdb',
    radius: '6px',
    surface: '#ffffff',
    text: '#47484a',
    overrideToolbarBackground: false,
    toolbarBackground: '#ffffff',
  },
  product: {
    action: '#4f46e5',
    border: '#cbd5e1',
    radius: '8px',
    surface: '#f8fafc',
    text: '#1e293b',
    overrideToolbarBackground: true,
    toolbarBackground: '#eef2ff',
  },
} as const satisfies Record<ThemePresetId, ThemeDraft>;

const colorControls = [
  { key: 'action', label: 'Action' },
  { key: 'surface', label: 'Surface' },
  { key: 'text', label: 'Text' },
  { key: 'border', label: 'Border' },
] as const;

function darkerColor(color: string) {
  const channels = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu)?.slice(1);
  if (!channels) return color;
  return `#${channels
    .map((channel) =>
      Math.round(Number.parseInt(channel, 16) * 0.82)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function HexColorInput({
  disabled,
  label,
  value,
  onChange,
}: {
  disabled: boolean;
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = /^#[\da-f]{6}$/iu.test(text);
  return (
    <input
      aria-label={`${label} hex color`}
      aria-invalid={!valid}
      disabled={disabled}
      maxLength={7}
      spellCheck={false}
      title='Use a six-digit hex color, such as #1355ff.'
      type='text'
      value={text}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setText(next);
        if (/^#[\da-f]{6}$/iu.test(next)) onChange(next.toLowerCase());
      }}
      onBlur={() => setText(value)}
    />
  );
}

function toThemeConfig(draft: ThemeDraft): ThemeConfig {
  return {
    name: THEME_NAME,
    colors: {
      action: draft.action,
      actionHover: darkerColor(draft.action),
      bg: draft.surface,
      text: draft.text,
      border: draft.border,
    },
    radius: draft.radius,
    vars: {
      // Keep the document page independent of the UI surface: `--sd-layout-page-bg` otherwise
      // inherits `--sd-ui-bg` and a dark Surface token repaints pages behind unchanged text.
      '--sd-layout-page-bg': '#ffffff',
      ...(draft.overrideToolbarBackground ? { '--sd-ui-toolbar-bg': draft.toolbarBackground } : {}),
    },
  };
}

function renderThemeCode(draft: ThemeDraft) {
  // The page pin is always emitted: it is what keeps `colors.bg` from repainting document pages.
  const variableOverride = draft.overrideToolbarBackground
    ? `\n  vars: { '--sd-layout-page-bg': '#ffffff', '--sd-ui-toolbar-bg': '${draft.toolbarBackground}' },`
    : `\n  vars: { '--sd-layout-page-bg': '#ffffff' },`;

  return `import { createTheme } from 'superdoc';

type ThemeConfig = Parameters<typeof createTheme>[0];

const productTheme = {
  name: 'product',
  colors: {
    action: '${draft.action}',
    actionHover: '${darkerColor(draft.action)}',
    bg: '${draft.surface}',
    text: '${draft.text}',
    border: '${draft.border}',
  },
  radius: '${draft.radius}',${variableOverride}
} satisfies ThemeConfig;

const themeClass = createTheme(productTheme);
document.documentElement.classList.add(themeClass);`;
}

export function ThemePlayground() {
  const rootRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const runtimeRef = useRef<SuperDocConstructor | null>(null);
  const dialogRef = useRef<SurfaceHandle | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(true);
  const openDialogButtonRef = useRef<HTMLButtonElement>(null);
  const restoreOpenerFocusRef = useRef(false);
  const readyRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const themeClassRef = useRef<string | null>(null);
  const ownsFullscreenRef = useRef(false);
  const loadIdRef = useRef(0);
  const mountedRef = useRef(true);
  const zoomRef = useRef<ZoomSlice>(INITIAL_ZOOM);

  const [draft, setDraft] = useState<ThemeDraft>(presets.product);
  const [preset, setPreset] = useState<ThemePresetId | null>('product');
  const [state, setState] = useState<DemoState>('idle');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('Change a token, then open the dialog.');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState<ZoomSlice>(INITIAL_ZOOM);

  const themeConfig = useMemo(() => toThemeConfig(draft), [draft]);
  const generatedCode = useMemo(() => renderThemeCode(draft), [draft]);

  const removeTheme = useCallback(() => {
    const themeClass = themeClassRef.current;
    if (!themeClass) return;
    document.documentElement.classList.remove(themeClass);
    document.documentElement.removeAttribute('data-sd-theme-active');
    document.querySelector(`[data-sd-theme="${themeClass}"]`)?.remove();
    themeClassRef.current = null;
  }, []);

  const applyTheme = useCallback(
    (runtime: SuperDocConstructor) => {
      const themeClass = runtime.createTheme(themeConfig);
      const previousClass = themeClassRef.current;
      if (previousClass && previousClass !== themeClass) {
        document.documentElement.classList.remove(previousClass);
      }
      document.documentElement.classList.add(themeClass);
      document.documentElement.setAttribute('data-sd-theme-active', '');
      themeClassRef.current = themeClass;
    },
    [themeConfig],
  );

  const teardown = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    dialogRef.current?.close('destroyed');
    dialogRef.current = null;
    setIsDialogOpen(false);
    instanceRef.current?.destroy();
    instanceRef.current = null;
  }, []);

  const start = useCallback(async () => {
    const loadId = (loadIdRef.current += 1);
    readyRef.current = false;
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
    const toolbar = toolbarRef.current;

    teardown();
    setState('loading');
    setError('');
    setMessage('Loading the document…');
    zoomRef.current = INITIAL_ZOOM;
    setZoom(INITIAL_ZOOM);

    if (!toolbar || !mountRef.current) {
      setState('error');
      setError('The theme example could not be mounted.');
      return;
    }

    try {
      const runtime = await loadRuntime();
      if (!isCurrent() || !mountRef.current) return;

      runtimeRef.current = runtime;
      applyTheme(runtime);

      const editorUi = {
        comments: false,
        loading: false,
        toolbar: {
          container: toolbar,
          groups: {
            left: ['undo', 'redo'],
            center: ['bold', 'italic', 'fontFamily', 'fontSize'],
            right: ['documentMode', 'zoom', 'overflow'],
          },
          responsiveToContainer: true,
        },
      } satisfies UIConfig;

      const instance = createRuntimeEditor(runtime, {
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
          setMessage('Change a token, then open the dialog.');
        },
        onContentError: () => {
          if (!isCurrent()) return;
          // Also covers failures while updating, so it can arrive after onReady with the
          // reader's edits in the session. Only a failure to open justifies destroying it.
          if (readyRef.current) {
            setMessage('The Editor could not apply that change. Your edits are still here.');
            return;
          }
          teardown();
          setState('error');
          setError('The sample document could not be read.');
        },
        onException: () => {
          if (isCurrent()) setMessage('The Editor reported a runtime error.');
        },
      });
      instanceRef.current = instance;

      const stopZoom = instance.ui.zoom.observe((snapshot) => {
        zoomRef.current = snapshot;
        if (isCurrent()) setZoom(snapshot);
      });
      cleanupRef.current = stopZoom;

      if (!isCurrent()) teardown();
    } catch (cause) {
      if (!isCurrent()) return;
      teardown();
      setState('error');
      setError(cause instanceof Error ? cause.message : 'The theme example could not start.');
    }
  }, [applyTheme, teardown]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) applyTheme(runtime);
  }, [applyTheme]);

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

    const syncFullscreen = () => {
      const root = rootRef.current;
      const active = document.fullscreenElement === document.documentElement && root?.dataset.fullscreen === 'true';
      ownsFullscreenRef.current = active;
      if (!active && root) delete root.dataset.fullscreen;
      setIsFullscreen(active);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);

    return () => {
      mountedRef.current = false;
      loadIdRef.current += 1;
      document.removeEventListener('fullscreenchange', syncFullscreen);
      if (ownsFullscreenRef.current && document.fullscreenElement === document.documentElement) {
        ownsFullscreenRef.current = false;
        void document.exitFullscreen().catch(() => {});
      }
      teardown();
      removeTheme();
    };
  }, [removeTheme, teardown]);

  function selectPreset(nextPreset: ThemePresetId) {
    setPreset(nextPreset);
    setDraft(presets[nextPreset]);
  }

  function updateDraft<K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) {
    setPreset(null);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function openDialog() {
    const instance = instanceRef.current;
    if (!instance) return;

    dialogRef.current?.close('replaced');
    const handle = instance.openSurface({
      mode: 'dialog',
      title: 'Theme reaches this dialog',
      render: ({ container, close }) => {
        const description = document.createElement('p');
        description.className = 'sd-theme-playground-dialog-copy';
        description.textContent = 'This surface is mounted under document.body and inherits the same semantic tokens.';

        const done = document.createElement('button');
        done.className = 'sd-theme-playground-dialog-button';
        done.type = 'button';
        done.textContent = 'Done';

        const closeDialog = () => close('done');
        done.addEventListener('click', closeDialog);
        container.append(description, done);

        return {
          destroy() {
            done.removeEventListener('click', closeDialog);
          },
        };
      },
    });

    // A built-in toolbar dropdown teleports its menu to <body>, above the surface host and
    // outside the inert regions below, so it would stay interactive over this modal. Dismissing
    // it after openSurface() is deliberate: the manager assigns activeDialog synchronously, and
    // SurfaceHost's floating handlers defer once a dialog holds the slot.
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));

    dialogRef.current = handle;
    setIsDialogOpen(true);
    setMessage('The dialog uses the same theme even though it is mounted under document.body.');
    void handle.result.then(() => {
      if (dialogRef.current !== handle) return;
      dialogRef.current = null;
      setIsDialogOpen(false);
      // SurfaceDialog restores focus while this opener is still inside the inert region, so that
      // call cannot land. Hand the restore to the layout effect below, which runs after React has
      // committed the cleared `inert`.
      restoreOpenerFocusRef.current = true;
    });
  }

  // A promise callback's state update renders in a later task, so a microtask queued beside it
  // still sees the inert region and its focus() is dropped. Restoring here runs after the commit
  // that clears `inert`.
  useLayoutEffect(() => {
    if (isDialogOpen || !restoreOpenerFocusRef.current) return;
    restoreOpenerFocusRef.current = false;
    openDialogButtonRef.current?.focus();
  }, [isDialogOpen]);

  function changeZoom(direction: -1 | 1) {
    const current = zoomRef.current;
    const next = Math.min(current.max, Math.max(current.min, current.value + direction * 10));
    instanceRef.current?.ui.zoom.set(next);
  }

  function fitToWidth() {
    if (instanceRef.current) fitRuntimeEditorToWidth(instanceRef.current);
  }

  async function toggleFullscreen() {
    const root = rootRef.current;
    if (!root) return;

    if (document.fullscreenElement === document.documentElement && root.dataset.fullscreen === 'true') {
      await document.exitFullscreen();
      return;
    }

    root.dataset.fullscreen = 'true';
    try {
      await document.documentElement.requestFullscreen();
      // The request can settle after an unmount, which has already run the only cleanup.
      if (!mountedRef.current) {
        void document.exitFullscreen().catch(() => {});
        return;
      }
      ownsFullscreenRef.current = true;
    } catch {
      ownsFullscreenRef.current = false;
      delete root.dataset.fullscreen;
      setMessage('Fullscreen could not start in this browser.');
    }
  }

  function collapseDemo() {
    dialogRef.current?.close('collapsed');
    mountRef.current?.scrollTo({ top: 0 });
  }

  const controlsReady = state === 'ready';

  return (
    <figure className='sd-theme-playground' data-state={state} data-theme-playground ref={rootRef}>
      <CollapsibleEditorPreview
        className='sd-theme-playground-preview'
        contentClassName='sd-theme-playground-workspace'
        defaultExpanded
        expandedMaxHeight='76rem'
        onCollapse={collapseDemo}
        onExpandedChange={setIsPreviewExpanded}
        toggleDisabled={isDialogOpen}
      >
        {/*
          SurfaceDialog traps Tab and Escape only on keydowns bubbling through its backdrop,
          and the teleported backdrop is clipped to the Editor viewport. Everything outside it
          has to be unreachable while the modal is open, not merely disabled one control at a
          time.
        */}
        <div className='sd-theme-playground-controls' inert={isDialogOpen}>
          <div className='sd-theme-playground-presets' role='group' aria-label='Theme preset'>
            {(Object.keys(presets) as ThemePresetId[]).map((presetId) => (
              <button
                aria-pressed={preset === presetId}
                disabled={!controlsReady}
                key={presetId}
                onClick={() => selectPreset(presetId)}
                type='button'
              >
                {presetId === 'default' ? 'Default' : 'Product'}
              </button>
            ))}
          </div>

          <div className='sd-theme-playground-tokens'>
            {colorControls.map(({ key, label }) => (
              <div className='sd-theme-playground-token' role='group' aria-label={label} key={key}>
                <span>{label}</span>
                <input
                  aria-label={`${label} color`}
                  disabled={!controlsReady}
                  onChange={(event) => updateDraft(key, event.target.value)}
                  type='color'
                  value={draft[key]}
                />
                <HexColorInput
                  disabled={!controlsReady}
                  label={label}
                  value={draft[key]}
                  onChange={(value) => updateDraft(key, value)}
                />
              </div>
            ))}
            <label>
              <span>Radius</span>
              <select
                aria-label='Border radius'
                disabled={!controlsReady}
                onChange={(event) => updateDraft('radius', event.target.value)}
                value={draft.radius}
              >
                <option value='0px'>0px</option>
                <option value='6px'>6px</option>
                <option value='8px'>8px</option>
                <option value='12px'>12px</option>
              </select>
            </label>
          </div>

          <div className='sd-theme-playground-actions'>
            <label className='sd-theme-playground-toolbar-toggle'>
              <input
                checked={draft.overrideToolbarBackground}
                disabled={!controlsReady}
                onChange={(event) => updateDraft('overrideToolbarBackground', event.target.checked)}
                type='checkbox'
              />
              Toolbar override
            </label>
            <button
              disabled={!controlsReady || !isPreviewExpanded}
              onClick={openDialog}
              ref={openDialogButtonRef}
              type='button'
            >
              Open dialog
            </button>
            <output aria-live='polite'>{message}</output>
          </div>
        </div>

        <div className='sd-theme-playground-editor-header'>
          <span>SuperDoc UI</span>
          <EditorDemoViewControls
            disabled={!controlsReady || isDialogOpen || !isPreviewExpanded}
            fitActive={zoom.mode === 'fit-width'}
            isFullscreen={isFullscreen}
            onFit={fitToWidth}
            onFullscreen={() => void toggleFullscreen()}
            onZoom={changeZoom}
            zoom={zoom}
          />
        </div>
        {/* The generated toolbar buttons are focusable siblings of the clipped backdrop. */}
        <div className='sd-theme-playground-toolbar' inert={isDialogOpen} ref={toolbarRef} />

        {error ? (
          <div className='sd-theme-playground-error' role='alert'>
            <p>{error}</p>
            <button onClick={() => void start()} type='button'>
              Try again
            </button>
          </div>
        ) : null}

        <div className='sd-theme-playground-canvas' ref={mountRef} />
        {/* The generated block renders its own Copy Text button, another focusable sibling. */}
        <div inert={isDialogOpen}>
          <DynamicCodeBlock
            code={generatedCode}
            codeblock={{ className: 'sd-theme-playground-code', title: 'theme.ts' }}
            lang='ts'
          />
        </div>
      </CollapsibleEditorPreview>
    </figure>
  );
}
