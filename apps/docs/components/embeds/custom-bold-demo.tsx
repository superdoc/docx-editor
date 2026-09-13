'use client';

import { Bold, Expand, Shrink } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIConfig } from 'superdoc';
import type {
  BorrowedSuperDocUI,
  CommandExecutionResult,
  CommandState,
  FontFamilyOption,
  FontSizeOption,
} from 'superdoc/ui';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { createRuntimeEditor, loadRuntime, type SuperDocInstance } from './superdoc-runtime';

/**
 * Application-owned formatting controls running against a real Editor.
 *
 * The Commands and state page carries a simulated model for comparing command
 * states. This embed proves the integration against a real document and stays
 * deliberately small: formatting commands, one result, no panels.
 */

// Purpose-built for this page: three short paragraphs, no tracked changes or
// comments. The shared NDA fixtures are full contracts, so the sentence the
// page asks the reader to select would be several screens down.
const DEMO_DOCUMENT = '/fixtures/formatting-sample.docx';
const HANDOFF_DOCUMENT = '/fixtures/getting-started.docx';
const DISABLED_BEFORE_SELECTION = 'Select text in the document to enable Bold.';

type DemoState = 'idle' | 'loading' | 'ready' | 'error';
type PickerCommandId = 'font-family' | 'font-size';
type PendingCommand = 'bold' | PickerCommandId | null;
type PickerOption = { value: string };

const INITIAL_COMMAND_STATE: CommandState = { active: false, enabled: false, supported: false };
const ZOOM = { max: 200, min: 10 } as const;

function getPickerValue(commandValue: unknown): string {
  return typeof commandValue === 'string' || typeof commandValue === 'number' ? String(commandValue) : '';
}

function hasPickerOption(options: readonly PickerOption[], value: string): boolean {
  return options.some((option) => option.value === value);
}

type CustomBoldDemoProps = {
  variant?: 'standalone' | 'handoff' | 'toolbar';
};

export function CustomBoldDemo({ variant = 'standalone' }: CustomBoldDemoProps) {
  const isHandoffVariant = variant === 'handoff';
  const isToolbarVariant = variant === 'toolbar';
  const rootRef = useRef<HTMLElement>(null);
  const builtInToolbarRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const uiRef = useRef<BorrowedSuperDocUI | null>(null);
  // Every startup is stamped with an id, and the component tracks whether it is
  // still mounted. Both guards exist because the async work below outlives the
  // attempt that began it: a retry, or an unmount, must not have its state
  // clobbered by a callback from a superseded load. `EditorDemo` uses the same
  // pair for the same reason.
  const loadIdRef = useRef(0);
  const mountedRef = useRef(true);

  const [state, setState] = useState<DemoState>('idle');
  const [bold, setBold] = useState<CommandState>(INITIAL_COMMAND_STATE);
  const [fontFamily, setFontFamily] = useState<CommandState>(INITIAL_COMMAND_STATE);
  const [fontSize, setFontSize] = useState<CommandState>(INITIAL_COMMAND_STATE);
  const [fontOptions, setFontOptions] = useState<readonly FontFamilyOption[]>([]);
  const [fontSizeOptions, setFontSizeOptions] = useState<readonly FontSizeOption[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCommand>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState('');

  const fitCleanupRef = useRef<(() => void) | null>(null);
  const observerCleanupRef = useRef<(() => void) | null>(null);

  /**
   * Fit the page to the mount's own width.
   *
   * The runtime's `fit-width` policy measures the whole editor container, which
   * includes chrome the document does not get. Measuring the mount here keeps
   * the page filling the frame instead of collapsing into it.
   */
  const connectFitToWidth = useCallback((instance: SuperDocInstance) => {
    const mount = mountRef.current;
    const editor = instance.activeEditor as { pageMetrics?: unknown } | null;
    const metrics = editor?.pageMetrics as
      | {
          getSnapshot(): { pages: ReadonlyArray<{ base: { widthPx: number } }> };
          subscribe(fn: () => void): () => void;
        }
      | undefined;
    if (!mount || typeof metrics?.getSnapshot !== 'function' || fitCleanupRef.current) return;

    const applyFit = () => {
      const widest = metrics.getSnapshot().pages.reduce((w, page) => Math.max(w, page.base.widthPx), 0);
      // `clientWidth` already excludes the mount's own padding, so the page gets
      // the full measured width. Subtracting a guessed margin here is what left
      // the page narrower than its frame, with the leftover showing as a gutter.
      const available = mount.clientWidth;
      if (!(widest > 0) || !(available > 0)) return;
      instance.setZoom(Math.max(ZOOM.min, Math.min(ZOOM.max, Math.round((available / widest) * 100))));
    };

    const resize = new ResizeObserver(applyFit);
    resize.observe(mount);
    const unsubscribe = metrics.subscribe(applyFit);
    fitCleanupRef.current = () => {
      resize.disconnect();
      unsubscribe();
    };
    applyFit();
  }, []);

  const teardown = useCallback(() => {
    fitCleanupRef.current?.();
    fitCleanupRef.current = null;
    observerCleanupRef.current?.();
    observerCleanupRef.current = null;
    uiRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
  }, []);

  const start = useCallback(async () => {
    // Supersede any in-flight attempt before starting this one.
    const loadId = (loadIdRef.current += 1);
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;

    teardown();
    setState('loading');
    setError('');
    setResult(null);
    // A command superseded by this reset will not clear its own pending flag,
    // because its load id no longer matches. Clearing here is what keeps the
    // fresh document from starting out with the old one's button disabled.
    setPending(null);
    setBold(INITIAL_COMMAND_STATE);
    setFontFamily(INITIAL_COMMAND_STATE);
    setFontSize(INITIAL_COMMAND_STATE);
    setFontOptions([]);
    setFontSizeOptions([]);

    try {
      const SuperDocCtor = await loadRuntime();
      // Re-check after the await. Without this, a component unmounted during
      // the load would construct an instance nothing ever destroys — the
      // effect cleanup already ran, against still-null refs.
      if (!isCurrent() || !mountRef.current) return;

      // The fixture request, DOCX parsing, and engine startup all fail
      // asynchronously, after the constructor has returned. Those never reach
      // the try/catch below, so without these the demo would sit in `loading`
      // forever and the retry affordance would be unreachable.
      const markError = (payload?: { error?: unknown }) => {
        // A late failure from a superseded attempt must not tear down the
        // instance a retry has since put in these refs.
        if (!isCurrent()) return;
        teardown();
        setState('error');
        const cause = payload?.error;
        setError(cause instanceof Error ? cause.message : 'The sample document could not be loaded.');
      };

      let editorUi: UIConfig = { comments: false, loading: false };
      if (isToolbarVariant) {
        editorUi = { ...editorUi, toolbar: false };
      } else if (isHandoffVariant) {
        const toolbarContainer = builtInToolbarRef.current;
        if (!toolbarContainer) throw new Error('The built-in toolbar could not be mounted.');
        editorUi = {
          ...editorUi,
          toolbar: {
            container: toolbarContainer,
            excludeItems: ['bold'],
            responsiveTo: 'container',
          },
        };
      }

      const instance = createRuntimeEditor(SuperDocCtor, {
        selector: mountRef.current,
        document: isHandoffVariant ? HANDOFF_DOCUMENT : DEMO_DOCUMENT,
        documentMode: 'editing',
        ui: editorUi,
        // Manual, measured against the mount rather than the runtime's own
        // fit policy, for the same reason: the measurement has to be of the
        // space the document actually gets.
        zoom: { mode: 'manual', fitWidth: { min: ZOOM.min, max: ZOOM.max } },
        onReady: () => {
          if (!isCurrent()) return;
          setState('ready');
          connectFitToWidth(instance);
        },
        onContentError: markError,
        onException: markError,
      });
      instanceRef.current = instance;

      // The Editor owns this controller and tears it down with the instance.
      const ui = instance.ui;
      uiRef.current = ui;
      const stopObservers: Array<() => void> = [];
      observerCleanupRef.current = () => {
        for (const stop of stopObservers) stop();
      };

      // `commands.get(id)` returns a handle that observes just this command,
      // which is all a single control needs.
      const boldCommand = ui.commands.get('bold');
      setBold(boldCommand.getState());
      stopObservers.push(
        boldCommand.observe((next) => {
          if (isCurrent()) setBold(next);
        }),
      );

      if (isToolbarVariant) {
        const fontFamilyCommand = ui.commands.get('font-family');
        const fontSizeCommand = ui.commands.get('font-size');
        const syncFonts = () => {
          const fonts = ui.fonts.getSnapshot();
          setFontOptions(fonts.options);
          setFontSizeOptions(fonts.sizeOptions);
        };

        setFontFamily(fontFamilyCommand.getState());
        setFontSize(fontSizeCommand.getState());
        syncFonts();
        stopObservers.push(
          fontFamilyCommand.observe((next) => {
            if (isCurrent()) setFontFamily(next);
          }),
          fontSizeCommand.observe((next) => {
            if (isCurrent()) setFontSize(next);
          }),
          ui.fonts.observe(() => {
            if (isCurrent()) syncFonts();
          }),
        );
      }

      // The component can unmount while the constructor is still wiring up.
      // Tear down here rather than leaking the instance the cleanup missed.
      if (!isCurrent()) teardown();
    } catch (cause) {
      if (!isCurrent()) return;
      teardown();
      setState('error');
      setError(cause instanceof Error ? cause.message : 'The demo could not start.');
    }
  }, [connectFitToWidth, isHandoffVariant, isToolbarVariant, teardown]);

  // Load when the demo scrolls into view rather than asking the reader to press
  // a button first. The runtime is a CDN fetch, so deferring it until the embed
  // is near the viewport keeps the page cheap without adding a decision.
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

  // Track the browser's own fullscreen state rather than assuming the button is
  // the only way out: Esc and the system control both exit without telling us.
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const node = rootRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement === node) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      // Fullscreen can be refused by policy or an unsupported browser. The
      // embed is fully usable inline, so a refusal is not worth an error state.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Bumping the id invalidates any in-flight attempt, so a continuation
      // that resolves after unmount sees `isCurrent()` false and tears itself
      // down instead of assigning into refs nothing will clean up.
      mountedRef.current = false;
      loadIdRef.current += 1;
      teardown();
    };
  }, [connectFitToWidth, teardown]);

  const runBold = useCallback(async () => {
    const ui = uiRef.current;
    if (!ui) return;

    // The command outlives the click, so it carries the load id it started
    // under. Reset destroys this controller and loads a fresh document; without
    // this, the old command's completion would clear `pending` and report an
    // edit belonging to the document that was just thrown away.
    const loadId = loadIdRef.current;
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;

    const handle = ui.commands.get('bold');
    // Bold is a toggle, so the direction has to be read before executing.
    // Reporting "Applied bold." unconditionally would contradict the
    // `active: false` the state readout shows right beside it.
    const wasActive = handle.getState().active;
    const applied = wasActive ? 'Removed bold.' : 'Applied bold.';

    setPending('bold');
    try {
      // Await the result rather than assuming the absence of a throw means the
      // document changed. This is the habit the page is teaching.
      //
      // `CommandExecutionResult` is `boolean | receipt`: a plain `true` means
      // the command ran without a receipt, so both shapes have to be read.
      const outcome = await handle.executeAsync();
      if (!isCurrent()) return;
      if (typeof outcome === 'boolean') {
        setResult(outcome ? applied : 'The command was refused.');
        return;
      }
      setResult(outcome.success ? applied : outcome.failure.message);
    } catch (cause) {
      // `executeAsync` resolves refusals rather than throwing, so reaching here
      // means the runtime itself failed. Say so instead of leaving the status
      // line on a stale hint.
      if (isCurrent()) setResult(cause instanceof Error ? cause.message : 'The command could not run.');
    } finally {
      // Unconditionally, or a rejection strands the button in its pending state
      // and the anatomy strip on step 3 until the page is reloaded.
      if (isCurrent()) setPending(null);
    }
  }, []);

  const runPickerCommand = useCallback(async (id: PickerCommandId, value: string, successMessage: string) => {
    const ui = uiRef.current;
    if (!ui || !value) return;

    const loadId = loadIdRef.current;
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
    setPending(id);

    try {
      const outcome: CommandExecutionResult = await ui.commands.get(id).executeAsync(value);
      if (!isCurrent()) return;
      if (typeof outcome === 'boolean') {
        setResult(outcome ? successMessage : 'The command was refused.');
        return;
      }
      setResult(outcome.success ? successMessage : outcome.failure.message);
    } catch (cause) {
      if (isCurrent()) setResult(cause instanceof Error ? cause.message : 'The command could not run.');
    } finally {
      if (isCurrent()) setPending(null);
    }
  }, []);

  // Which habit the reader is currently exercising, so the anatomy strip below
  // can highlight it. Derived from the same state the button reads rather than
  // tracked separately, so it cannot disagree with what the control is doing.
  const step: 1 | 2 | 3 | 4 = result !== null ? 4 : pending !== null ? 3 : bold.enabled ? 2 : 1;

  const fontFamilyValue = getPickerValue(fontFamily.value);
  const fontSizeValue = getPickerValue(fontSize.value);

  // One status line for the whole embed: the last command outcome when there is
  // one, otherwise a hint derived from the same command state the button reads.
  const readyHint = isToolbarVariant
    ? 'The toolbar follows the current selection.'
    : 'Press Bold to format the selection.';
  const disabledHint = isToolbarVariant
    ? 'Select text to enable the toolbar.'
    : 'Select text in the document to enable Bold.';
  const plainState =
    state === 'loading' ? 'Loading the document…' : (result ?? (!bold.enabled ? disabledHint : readyHint));

  const applicationControls =
    state !== 'idle' && state !== 'error' ? (
      <div
        className='sd-custom-bold-demo-toolbar'
        role='toolbar'
        aria-label={
          isToolbarVariant ? 'Custom formatting toolbar' : isHandoffVariant ? 'Application controls' : 'Custom controls'
        }
      >
        {isHandoffVariant ? (
          <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
            Your application
          </span>
        ) : null}
        <button
          aria-pressed={bold.active}
          data-testid='custom-bold'
          // `pending` as well as `enabled`: Bold is a toggle whose direction is
          // read before executing, so a second click landing mid-flight would
          // compute its direction from state the first has not finished
          // changing, and the earlier completion would publish a result for
          // the later one.
          disabled={!bold.enabled || pending !== null}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void runBold()}
          title={bold.enabled ? 'Bold' : (bold.reason ?? DISABLED_BEFORE_SELECTION)}
          type='button'
        >
          <Bold aria-hidden='true' size={16} />
          Bold
        </button>

        {isToolbarVariant ? (
          <>
            <label className='sd-custom-bold-demo-field'>
              <span>Font</span>
              <select
                data-testid='custom-font-family'
                disabled={!fontFamily.enabled || pending !== null}
                onChange={(event) =>
                  void runPickerCommand('font-family', event.target.value, `Font changed to ${event.target.value}.`)
                }
                value={fontFamilyValue}
              >
                <option disabled value=''>
                  Mixed
                </option>
                {fontFamilyValue && !hasPickerOption(fontOptions, fontFamilyValue) ? (
                  <option style={{ fontFamily: fontFamilyValue }} value={fontFamilyValue}>
                    {fontFamilyValue}
                  </option>
                ) : null}
                {fontOptions.map((option) => (
                  <option key={option.value} style={{ fontFamily: option.previewFamily }} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className='sd-custom-bold-demo-field'>
              <span>Size</span>
              <select
                data-testid='custom-font-size'
                disabled={!fontSize.enabled || pending !== null}
                onChange={(event) =>
                  void runPickerCommand('font-size', event.target.value, `Font size changed to ${event.target.value}.`)
                }
                value={fontSizeValue}
              >
                <option disabled value=''>
                  Mixed
                </option>
                {fontSizeValue && !hasPickerOption(fontSizeOptions, fontSizeValue) ? (
                  <option value={fontSizeValue}>{fontSizeValue}</option>
                ) : null}
                {fontSizeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {/* One quiet line. The raw controller values belong in the prose and
          the simulated model below, not competing with the document. */}
        <output className='sd-custom-bold-demo-state' data-testid='custom-bold-state'>
          {plainState}
        </output>

        <button
          className='sd-custom-bold-demo-reset'
          data-testid='custom-bold-reset'
          onClick={() => void start()}
          type='button'
        >
          Reset
        </button>

        <button
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className='sd-custom-bold-demo-expand'
          data-testid='custom-bold-expand'
          onClick={() => void toggleFullscreen()}
          type='button'
        >
          {isFullscreen ? <Shrink aria-hidden='true' size={15} /> : <Expand aria-hidden='true' size={15} />}
        </button>
      </div>
    ) : null;

  const builtInControls = isHandoffVariant ? (
    <div className='sd-custom-bold-demo-built-in'>
      <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
        SuperDoc UI
      </span>
      <div className='sd-custom-bold-demo-built-in-toolbar' ref={builtInToolbarRef} />
    </div>
  ) : null;

  return (
    <figure
      className='sd-custom-bold-demo'
      ref={rootRef}
      data-custom-bold-demo
      data-custom-toolbar-demo={isToolbarVariant || undefined}
      data-state={state}
      data-variant={variant}
    >
      {isHandoffVariant ? (
        <>
          {applicationControls}
          {builtInControls}
        </>
      ) : null}

      <CollapsibleEditorPreview className='sd-custom-bold-demo-preview' defaultExpanded={isToolbarVariant}>
        {state === 'error' ? (
          <div className='sd-custom-bold-demo-error' role='alert'>
            <p>{error}</p>
            <button onClick={() => void start()} type='button'>
              Try again
            </button>
          </div>
        ) : null}

        {!isHandoffVariant ? applicationControls : null}

        <div className='sd-custom-bold-demo-canvas' ref={mountRef} />
      </CollapsibleEditorPreview>

      {variant === 'standalone' ? (
        <ol aria-label='Anatomy of a command control' className='sd-anatomy'>
          <li className='sd-anatomy-step' data-active={step === 1}>
            <b>1 Observe</b>
            <code>enabled · active</code>
          </li>
          <li className='sd-anatomy-step' data-active={step === 2}>
            <b>2 Render</b>
            <code>disabled · aria-pressed</code>
          </li>
          <li className='sd-anatomy-step' data-active={step === 3}>
            <b>3 Execute</b>
            <code>executeAsync()</code>
          </li>
          <li className='sd-anatomy-step' data-active={step === 4}>
            <b>4 Read outcome</b>
            <code>boolean or receipt</code>
          </li>
        </ol>
      ) : null}
    </figure>
  );
}

export function CustomToolbarDemo() {
  return <CustomBoldDemo variant='toolbar' />;
}
