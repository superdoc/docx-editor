'use client';

import { Bold, Check, Italic, RotateCcw, Underline, Undo2, X } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import type {
  Config,
  ContentControlRef,
  ContextMenuConfig,
  DocumentMode,
  SuperDocMeasurementUnit,
  ViewingTrackedChangesMode,
} from 'superdoc';
import type { CommandState, SuperDocUI, ZoomSlice } from 'superdoc/ui';
import {
  commentsDemoLayouts,
  commentsDemoLevels,
  contextMenuDemoStrategies,
  getRulerHint,
  hasRulerSelection,
  hyperlinkDemoBehaviors,
  toolbarDemoExcludedItems,
  toolbarDemoItems,
  toolbarDemoStrategies,
  type BuiltInDemoChoice,
  type CommentsDemoLayout,
  type CommentsDemoLevel,
  type ContextMenuDemoStrategy,
  type HyperlinkDemoBehavior,
  type ToolbarDemoStrategy,
} from '@/lib/built-in-editor-demos';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { createRuntimeEditor, loadRuntime, loadUIModule, type SuperDocInstance } from './superdoc-runtime';

const zoomStep = 10;
const initialZoom = { max: 200, min: 10, mode: 'manual', value: 100 } satisfies ZoomSlice;

type EditorDemoPreset =
  | 'comments'
  | 'content-controls'
  | 'context-menu'
  | 'document-modes'
  | 'hyperlinks'
  | 'loading'
  | 'proofing'
  | 'ruler'
  | 'search'
  | 'toolbar'
  | 'tracked-review';

type EditorDemoProps = {
  allowLocalFile?: boolean;
  fixture?: string;
  preset: EditorDemoPreset;
  title: string;
};

type DemoState = 'idle' | 'loading' | 'ready' | 'error';

type MountDocumentOptions = {
  commentsLayout?: CommentsDemoLayout;
  commentsLevel?: CommentsDemoLevel;
  contentControlChrome?: boolean;
  contextMenuStrategy?: ContextMenuDemoStrategy;
  documentMode?: DocumentMode;
  hyperlinkBehavior?: HyperlinkDemoBehavior;
  includeTrackedDeletions?: boolean;
  replaceControls?: boolean;
  toolbarStrategy?: ToolbarDemoStrategy;
};

type RetryMount = {
  getFile: () => Promise<File>;
  options: MountDocumentOptions;
};

type UiConfig = Exclude<NonNullable<Config['ui']>, false>;
type CommentsUiConfig = Exclude<NonNullable<UiConfig['comments']>, boolean>;
type ToolbarUiConfig = Exclude<NonNullable<UiConfig['toolbar']>, boolean>;

function documentReplacementSucceeded(result: unknown) {
  const state = result && typeof result === 'object' ? (result as { state?: unknown }).state : undefined;
  return state === undefined || state === null || state === 'review-ready' || state === 'editing-ready';
}

const pinnedToolbarItems = {
  left: [...toolbarDemoItems.left],
  center: [...toolbarDemoItems.center],
  // Translate the public item id and include the overflow trigger required by
  // the stable release pinned in config/editor-demo-runtime.json.
  right: ['documentMode', 'zoom', 'overflow'],
};

const addNoteIcon = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
  '<path d="M12 5v14M5 12h14"/>',
  '</svg>',
].join('');

function getPinnedToolbarBaseOptions(container: HTMLDivElement): ToolbarUiConfig {
  // The docs app runs the exact stable release pinned in editor-demo-runtime.json.
  // Keep the layout adapter separate from the public customItems configuration.
  return { container, responsiveToContainer: true };
}

function getPinnedFocusedToolbarOptions(
  container: HTMLDivElement,
  items: Readonly<Record<string, readonly string[]>>,
): ToolbarUiConfig {
  return { ...getPinnedToolbarBaseOptions(container), groups: items };
}

function getPinnedToolbarOptions(strategy: ToolbarDemoStrategy, container: HTMLDivElement): ToolbarUiConfig {
  const shared = getPinnedToolbarBaseOptions(container);

  if (strategy === 'excludeItems') {
    return { ...shared, excludeItems: [...toolbarDemoExcludedItems] };
  }

  if (strategy === 'customItems') {
    return {
      ...getPinnedFocusedToolbarOptions(container, pinnedToolbarItems),
      customItems: [
        {
          type: 'button',
          id: 'addReviewNote',
          region: 'center',
          label: 'Add note',
          tooltip: 'Insert a review note',
          icon: addNoteIcon,
          onSelect: ({ insertText }) => insertText('Review note: '),
        },
      ],
    };
  }

  return getPinnedFocusedToolbarOptions(container, pinnedToolbarItems);
}

function getPinnedCommentsOptions(layout: CommentsDemoLayout): CommentsUiConfig {
  // The exact stable release in editor-demo-runtime.json predates `layout`.
  // Published examples and agent Markdown use the canonical field.
  return { displayMode: layout };
}

type DemoConfigGroupProps<T extends string> = {
  disabled: boolean;
  label: string;
  onChange(value: T): void;
  options: readonly BuiltInDemoChoice<T>[];
  value: T;
};

function DemoConfigGroup<T extends string>({ disabled, label, onChange, options, value }: DemoConfigGroupProps<T>) {
  return (
    <div className='sd-editor-demo-config-group'>
      <span>{label}</span>
      <div role='group' aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type='button'
            aria-pressed={value === option.id}
            disabled={disabled}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const documentModes = [
  { id: 'editing', label: 'Editing', note: 'Typing changes the document directly.' },
  { id: 'suggesting', label: 'Suggesting', note: 'Typing is recorded as a tracked change.' },
  { id: 'viewing', label: 'Viewing', note: 'Read-only — compare the original, markup, or final result.' },
] as const satisfies ReadonlyArray<{ id: DocumentMode; label: string; note: string }>;

const viewingTrackedChangesModes = [
  { id: 'original', label: 'Original' },
  { id: 'markup', label: 'Markup' },
  { id: 'final', label: 'Final' },
] as const satisfies readonly BuiltInDemoChoice<ViewingTrackedChangesMode>[];

const searchDocumentModes = [
  { id: 'editing', label: 'Editing' },
  { id: 'viewing', label: 'Viewing' },
] as const satisfies readonly BuiltInDemoChoice<'editing' | 'viewing'>[];

type PageMetricsSnapshot = {
  pages: ReadonlyArray<{
    base: { widthPx: number };
  }>;
};

type PageMetricsHandle = {
  getSnapshot(): PageMetricsSnapshot;
  subscribe(listener: (snapshot: PageMetricsSnapshot) => void): () => void;
};

type ProofingProvider = NonNullable<NonNullable<Config['proofing']>['provider']>;

const proofingReplacements = new Map([
  ['mispelled', 'misspelled'],
  ['teh', 'the'],
  ['workng', 'working'],
]);

const proofingProvider: ProofingProvider = {
  id: 'docs-proofing-demo',
  check: async ({ segments, signal }) => ({
    issues: segments.flatMap((segment) => {
      if (signal?.aborted) return [];

      return [...segment.text.matchAll(/[\p{L}]+/gu)].flatMap((match) => {
        const replacement = proofingReplacements.get(match[0].toLowerCase());
        if (!replacement) return [];

        return [
          {
            segmentId: segment.id,
            start: match.index,
            end: match.index + match[0].length,
            kind: 'spelling',
            replacements: [replacement],
          },
        ];
      });
    }),
  }),
};

function getPageMetrics(instance: SuperDocInstance): PageMetricsHandle | null {
  const editor = instance.activeEditor as { pageMetrics?: unknown } | null;
  const candidate = editor?.pageMetrics;
  if (!candidate || typeof candidate !== 'object') return null;

  const pageMetrics = candidate as Partial<PageMetricsHandle>;
  if (typeof pageMetrics.getSnapshot !== 'function' || typeof pageMetrics.subscribe !== 'function') return null;
  return pageMetrics as PageMetricsHandle;
}

function initialCommandStates() {
  return {
    bold: { active: false, enabled: false, supported: false },
    italic: { active: false, enabled: false, supported: false },
    underline: { active: false, enabled: false, supported: false },
    undo: { active: false, enabled: false, supported: false },
  } satisfies Record<string, CommandState>;
}

export function EditorDemo({ allowLocalFile = false, fixture, preset, title }: EditorDemoProps) {
  const demoRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadIdRef = useRef(0);
  const mountRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const mountedRef = useRef(true);
  const retryMountRef = useRef<RetryMount | null>(null);
  const fitActiveRef = useRef(true);
  const fitZoomRef = useRef<number | null>(null);
  const fitCleanupRef = useRef<(() => void) | null>(null);
  const fitToWidthRef = useRef<(() => void) | null>(null);
  const uiCleanupRef = useRef<(() => void) | null>(null);
  const uiRef = useRef<SuperDocUI | null>(null);
  const zoomRef = useRef<ZoomSlice>(initialZoom);
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null);
  const [commandStates, setCommandStates] = useState(initialCommandStates);
  const [commentsLayout, setCommentsLayout] = useState<CommentsDemoLayout>('auto');
  const [commentsLevel, setCommentsLevel] = useState<CommentsDemoLevel>('resolve');
  const [contentControlChrome, setContentControlChrome] = useState(true);
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [documentMode, setDocumentMode] = useState<DocumentMode>(
    preset === 'tracked-review' ? 'suggesting' : 'editing',
  );
  const [fitActive, setFitActive] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastContentControl, setLastContentControl] = useState<ContentControlRef | null>(null);
  const [contextMenuActionStatus, setContextMenuActionStatus] = useState<string | null>(null);
  const [contextMenuStrategy, setContextMenuStrategy] = useState<ContextMenuDemoStrategy>('custom');
  const [hyperlinkBehavior, setHyperlinkBehavior] = useState<HyperlinkDemoBehavior>('default');
  const [includeTrackedDeletions, setIncludeTrackedDeletions] = useState(false);
  const [modeResetBusy, setModeResetBusy] = useState(false);
  const [replaceControls, setReplaceControls] = useState(true);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerUnit, setRulerUnit] = useState<SuperDocMeasurementUnit>('in');
  const [rulerVisible, setRulerVisible] = useState(true);
  const [state, setState] = useState<DemoState>('idle');
  const [toolbarStrategy, setToolbarStrategy] = useState<ToolbarDemoStrategy>('items');
  const [trackedChangeCount, setTrackedChangeCount] = useState(0);
  const [viewingTrackedChanges, setViewingTrackedChanges] = useState<ViewingTrackedChangesMode>('original');
  const [zoom, setZoom] = useState<ZoomSlice>(initialZoom);

  function destroyEditor() {
    fitCleanupRef.current?.();
    fitCleanupRef.current = null;
    fitToWidthRef.current = null;
    uiCleanupRef.current?.();
    uiCleanupRef.current = null;
    uiRef.current?.destroy();
    uiRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
    fitZoomRef.current = null;
  }

  function setDemoInteractionBlocked(blocked: boolean) {
    const surfaces = [toolbarRef.current, mountRef.current].filter(
      (surface): surface is HTMLDivElement => surface !== null,
    );
    if (blocked && surfaces.some((surface) => surface.contains(document.activeElement))) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
    surfaces.forEach((surface) => {
      surface.inert = blocked;
    });
  }

  function connectFitToWidth(instance: SuperDocInstance) {
    if (fitCleanupRef.current) return;
    const mount = mountRef.current;
    const pageMetrics = getPageMetrics(instance);
    if (!mount || !pageMetrics) return;

    const applyFit = () => {
      if (!fitActiveRef.current) return;

      const widestPage = pageMetrics.getSnapshot().pages.reduce((width, page) => Math.max(width, page.base.widthPx), 0);
      const availableWidth = mount.clientWidth - 32;
      if (!(widestPage > 0) || !(availableWidth > 0)) return;

      const { min, max } = zoomRef.current;
      const nextZoom = Math.max(min, Math.min(max, Math.round((availableWidth / widestPage) * 100)));
      if (nextZoom === Math.round(zoomRef.current.value)) return;
      fitZoomRef.current = nextZoom;
      instance.setZoom(nextZoom);
    };

    const resizeObserver = new ResizeObserver(applyFit);
    resizeObserver.observe(mount);
    const unsubscribe = pageMetrics.subscribe(applyFit);

    fitToWidthRef.current = applyFit;
    fitCleanupRef.current = () => {
      resizeObserver.disconnect();
      unsubscribe();
    };
    applyFit();
  }

  useEffect(() => {
    mountedRef.current = true;

    const handleFullscreenChange = () => {
      const active =
        document.fullscreenElement === document.documentElement && demoRef.current?.dataset.fullscreen === 'true';
      if (!active && demoRef.current) delete demoRef.current.dataset.fullscreen;
      setIsFullscreen(active);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      mountedRef.current = false;
      loadIdRef.current += 1;
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      destroyEditor();
    };
  }, []);

  function connectToolbar(ui: SuperDocUI) {
    const cleanup = Object.entries(initialCommandStates()).map(([id]) =>
      ui.commands.get(id).observe((commandState) => {
        if (!mountedRef.current) return;
        setCommandStates((current) => ({ ...current, [id]: commandState }));
      }),
    );

    cleanup.push(
      ui.trackChanges.observe((snapshot) => {
        if (!mountedRef.current) return;
        setTrackedChangeCount(snapshot.total);

        const nextActiveId = snapshot.activeId ?? snapshot.items[0]?.id ?? null;
        if (!snapshot.activeId && nextActiveId) ui.trackChanges.setActive(nextActiveId);
        setActiveChangeId(nextActiveId);
      }),
      ui.zoom.observe((snapshot) => {
        zoomRef.current = snapshot;
        if (mountedRef.current) setZoom(snapshot);
      }),
    );

    if (preset === 'ruler') {
      cleanup.push(
        ui.selection.observe((snapshot) => {
          if (mountedRef.current) setRulerActive(hasRulerSelection(snapshot));
        }),
      );
    }

    uiCleanupRef.current = () => cleanup.forEach((unsubscribe) => unsubscribe());
  }

  function getContextMenu(strategy: ContextMenuDemoStrategy): true | ContextMenuConfig {
    if (strategy === 'default') return true;

    return {
      includeDefaultItems: true,
      customItems: [
        {
          id: 'application-actions',
          items: [
            {
              id: 'send-selection-to-workflow',
              label: 'Send selection to workflow',
              showWhen: ({ hasSelection, trigger }) => trigger === 'click' && hasSelection,
              onSelect: async ({ context }) => {
                const text = (await context?.selectedTextSettled)?.trim();
                if (!mountedRef.current) return;
                setContextMenuActionStatus(
                  text ? `Sent “${text.slice(0, 48)}” to the workflow.` : 'Select text first.',
                );
              },
            },
          ],
        },
      ],
    };
  }

  function getPinnedRuntimeLinkPopover(behavior: HyperlinkDemoBehavior): UiConfig['linkPopover'] {
    if (behavior === 'suppress') return false;
    if (behavior === 'default') return undefined;

    return {
      popoverResolver: ({ href }) => ({
        type: 'external',
        render: ({ container, closePopover }) => {
          const link = document.createElement('a');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Open in a new tab';

          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = 'Close';
          button.addEventListener('click', closePopover);
          container.append(link, button);

          return { destroy: () => button.removeEventListener('click', closePopover) };
        },
      }),
    };
  }

  async function mountDocument(getFile?: () => Promise<File>, options: MountDocumentOptions = {}) {
    if (!mountRef.current || state === 'loading') return false;

    const loadId = ++loadIdRef.current;
    const hadMountedEditor = instanceRef.current !== null;
    const initialCommentsLayout = options.commentsLayout ?? 'auto';
    const initialCommentsLevel = options.commentsLevel ?? 'resolve';
    const initialContentControlChrome = options.contentControlChrome ?? true;
    const initialContextMenuStrategy = options.contextMenuStrategy ?? 'custom';
    const initialDocumentMode = options.documentMode ?? (preset === 'tracked-review' ? 'suggesting' : 'editing');
    const initialHyperlinkBehavior = options.hyperlinkBehavior ?? 'default';
    const initialIncludeTrackedDeletions = options.includeTrackedDeletions ?? false;
    const initialReplaceControls = options.replaceControls ?? true;
    const initialToolbarStrategy = options.toolbarStrategy ?? 'items';
    // The loading preset exists to expose the real status/progress surface.
    // `inert` would remove that status from the accessibility tree.
    if (preset !== 'loading') setDemoInteractionBlocked(true);
    setConfigurationError(null);
    setState('loading');
    let replacedEditor = false;

    const markError = () => {
      if (!mountedRef.current || loadId !== loadIdRef.current) return;
      setState('error');
      window.setTimeout(() => {
        if (loadId !== loadIdRef.current) return;
        destroyEditor();
      });
    };

    try {
      const [file, SuperDoc, uiModule] = await Promise.all([getFile?.(), loadRuntime(), loadUIModule()]);
      if (!mountedRef.current || !mountRef.current || loadId !== loadIdRef.current) return false;
      const builtInToolbar = toolbarRef.current;
      if ((preset === 'hyperlinks' || preset === 'search' || preset === 'toolbar') && !builtInToolbar) {
        throw new Error('The built-in toolbar mount is unavailable.');
      }

      destroyEditor();
      replacedEditor = true;
      setActiveChangeId(null);
      setCommandStates(initialCommandStates());
      setCommentsLayout(initialCommentsLayout);
      setCommentsLevel(initialCommentsLevel);
      setContentControlChrome(initialContentControlChrome);
      setDocumentMode(initialDocumentMode);
      setContextMenuActionStatus(null);
      setContextMenuStrategy(initialContextMenuStrategy);
      setHyperlinkBehavior(initialHyperlinkBehavior);
      setIncludeTrackedDeletions(initialIncludeTrackedDeletions);
      setLastContentControl(null);
      fitActiveRef.current = true;
      setFitActive(true);
      setModeResetBusy(false);
      setReplaceControls(initialReplaceControls);
      setReviewBusy(false);
      setRulerActive(false);
      setRulerUnit('in');
      setRulerVisible(true);
      setToolbarStrategy(initialToolbarStrategy);
      setTrackedChangeCount(0);
      setViewingTrackedChanges('original');
      zoomRef.current = initialZoom;
      setZoom(initialZoom);

      let instance: SuperDocInstance | null = null;
      instance = createRuntimeEditor(SuperDoc, {
        selector: mountRef.current,
        document: file ?? SuperDoc.BlankDOCX,
        documentMode: initialDocumentMode,
        proofing: preset === 'proofing' ? { enabled: true, provider: proofingProvider } : undefined,
        ui: {
          comments: getPinnedCommentsOptions(preset === 'comments' ? initialCommentsLayout : 'inline'),
          loading: preset === 'loading',
          ...(preset === 'search'
            ? {
                // AIDEV-NOTE: The embed runs the exact stable release in
                // config/editor-demo-runtime.json. Keep these older fields
                // inside this adapter until that pin includes the canonical
                // SearchConfig names used by the published examples.
                search: {
                  replaceEnabled: initialReplaceControls,
                  includeDeletedText: initialIncludeTrackedDeletions,
                },
                toolbar: getPinnedFocusedToolbarOptions(builtInToolbar!, { left: ['search'] }),
              }
            : {}),
          ...(preset === 'context-menu'
            ? {
                comments: false,
                contextMenu: getContextMenu(initialContextMenuStrategy),
              }
            : {}),
          ...(preset === 'content-controls'
            ? {
                comments: false,
                contentControls: initialContentControlChrome,
              }
            : {}),
          ...(preset === 'hyperlinks'
            ? {
                comments: false,
                // AIDEV-NOTE: This embed executes the exact stable release in
                // config/editor-demo-runtime.json. Keep this adapter until that
                // pin supports the canonical Config.hyperlinks API used below.
                linkPopover: getPinnedRuntimeLinkPopover(initialHyperlinkBehavior),
                toolbar: getPinnedFocusedToolbarOptions(builtInToolbar!, { center: ['link'] }),
              }
            : {}),
          ...(preset === 'ruler' ? { comments: false, ruler: true } : {}),
          ...(preset === 'toolbar'
            ? { toolbar: getPinnedToolbarOptions(initialToolbarStrategy, builtInToolbar!) }
            : {}),
        },
        interaction: preset === 'comments' ? { comments: { level: initialCommentsLevel } } : undefined,
        measurementUnit: preset === 'ruler' ? 'in' : undefined,
        viewing: preset === 'document-modes' ? { trackedChanges: 'original' } : undefined,
        zoom: {
          mode: 'manual',
          fitWidth: { min: initialZoom.min, max: initialZoom.max },
        },
        user: {
          name: 'Docs visitor',
          email: 'docs@example.com',
        },
        onReady: ({ superdoc: readySuperDoc }) => {
          if (!mountedRef.current || loadId !== loadIdRef.current) return;
          if (preset === 'proofing') {
            void readySuperDoc.activeEditor?.doc?.insert({ value: 'Proofing finds mispelled words as you type.' });
          }
          retryMountRef.current = null;
          setState('ready');
          if (instance) connectFitToWidth(instance);
        },
        onZoomChange: ({ zoom: nextZoom }) => {
          if (fitZoomRef.current === nextZoom) {
            fitZoomRef.current = null;
            return;
          }
          if (!fitActiveRef.current) return;
          fitActiveRef.current = false;
          if (mountedRef.current) setFitActive(false);
        },
        onContentControlClick: ({ target }) => {
          if (mountedRef.current) setLastContentControl(target);
        },
        onContentError: markError,
        onException: markError,
      });
      instanceRef.current = instance;
      connectFitToWidth(instance);

      const ui = uiModule.createSuperDocUI({ superdoc: instance });
      uiRef.current = ui;
      connectToolbar(ui);
      return true;
    } catch {
      if (loadId !== loadIdRef.current) return false;
      if (replacedEditor) destroyEditor();
      if (mountedRef.current) setState(replacedEditor || !hadMountedEditor ? 'error' : 'ready');
      return false;
    } finally {
      if (mountedRef.current && loadId === loadIdRef.current) setDemoInteractionBlocked(false);
    }
  }

  async function getFixtureFile() {
    if (!fixture) throw new Error('This editor demo does not have a fixture.');
    const response = await fetch(fixture);
    if (!response.ok) throw new Error(`Fixture request failed with ${response.status}.`);

    const blob = await response.blob();
    const fileName = fixture.split('/').at(-1) ?? 'document.docx';
    return new File([blob], fileName, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  function loadDemo() {
    const retry = retryMountRef.current;
    void mountDocument(retry?.getFile ?? (fixture ? getFixtureFile : undefined), retry?.options);
  }

  useEffect(() => {
    const demo = demoRef.current;
    if (!demo || state !== 'idle') return;

    if (typeof IntersectionObserver === 'undefined') {
      loadDemo();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadDemo();
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(demo);

    return () => observer.disconnect();
  }, [fixture, state]);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function loadLocalFile(file: File | undefined) {
    if (!file) return;
    void mountDocument(async () => file);
  }

  function runCommand(id: keyof ReturnType<typeof initialCommandStates>) {
    void uiRef.current?.commands.get(id).executeAsync();
  }

  function changeDocumentMode(mode: DocumentMode) {
    if (state !== 'ready') return;
    const instance = instanceRef.current;
    instance?.setDocumentMode(mode);
    setDocumentMode(mode);
  }

  function changeViewingTrackedChanges(mode: ViewingTrackedChangesMode) {
    const instance = instanceRef.current;
    if (!instance || preset !== 'document-modes' || documentMode !== 'viewing' || state !== 'ready') return;

    instance.setViewingOptions({ trackedChanges: mode });
    setViewingTrackedChanges(mode);
  }

  async function reconfigureDemo(options: Partial<MountDocumentOptions>) {
    const instance = instanceRef.current;
    if (!instance || state !== 'ready' || configurationBusy) return;

    setDemoInteractionBlocked(true);
    setConfigurationBusy(true);
    setConfigurationError(null);
    try {
      const currentDocumentMode = instance.config.documentMode;
      const exported = await instance.export({ exportType: ['docx'], triggerDownload: false });
      if (!(exported instanceof Blob)) throw new Error('SuperDoc did not return the current DOCX.');

      const fileName = fixture?.split('/').at(-1) ?? 'document.docx';
      const currentFile = new File([exported], fileName, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const retry = {
        getFile: async () => currentFile,
        options: {
          commentsLayout,
          commentsLevel,
          contentControlChrome,
          contextMenuStrategy,
          documentMode: currentDocumentMode,
          hyperlinkBehavior,
          includeTrackedDeletions,
          replaceControls,
          toolbarStrategy,
          ...options,
        },
      } satisfies RetryMount;
      retryMountRef.current = retry;
      const mounted = await mountDocument(retry.getFile, retry.options);
      if (!mounted) throw new Error('SuperDoc could not update the configuration.');
    } catch {
      if (mountedRef.current) {
        setConfigurationError('The configuration could not be updated. Try again.');
      }
    } finally {
      setDemoInteractionBlocked(false);
      if (mountedRef.current) setConfigurationBusy(false);
    }
  }

  function changeToolbarStrategy(strategy: ToolbarDemoStrategy) {
    if (strategy === toolbarStrategy) return;
    void reconfigureDemo({ toolbarStrategy: strategy });
  }

  function changeCommentsLayout(layout: CommentsDemoLayout) {
    if (layout === commentsLayout) return;
    void reconfigureDemo({ commentsLayout: layout });
  }

  function changeCommentsLevel(level: CommentsDemoLevel) {
    if (level === commentsLevel) return;
    void reconfigureDemo({ commentsLevel: level });
  }

  function changeContentControlChrome(value: 'show' | 'hide') {
    const nextContentControlChrome = value === 'show';
    if (nextContentControlChrome === contentControlChrome) return;
    void reconfigureDemo({ contentControlChrome: nextContentControlChrome });
  }

  function changeContextMenuStrategy(strategy: ContextMenuDemoStrategy) {
    if (strategy === contextMenuStrategy) return;
    void reconfigureDemo({ contextMenuStrategy: strategy });
  }

  function changeHyperlinkBehavior(behavior: HyperlinkDemoBehavior) {
    if (behavior === hyperlinkBehavior) return;
    void reconfigureDemo({ hyperlinkBehavior: behavior });
  }

  function changeSearchReplaceControls(value: 'show' | 'hide') {
    const nextReplaceControls = value === 'show';
    if (nextReplaceControls === replaceControls) return;
    void reconfigureDemo({ replaceControls: nextReplaceControls });
  }

  function changeSearchTrackedDeletions(value: 'exclude' | 'include') {
    const nextIncludeTrackedDeletions = value === 'include';
    if (nextIncludeTrackedDeletions === includeTrackedDeletions) return;
    void reconfigureDemo({ includeTrackedDeletions: nextIncludeTrackedDeletions });
  }

  function changeRulerVisibility(value: 'show' | 'hide') {
    const nextVisible = value === 'show';
    if (nextVisible === rulerVisible || state !== 'ready') return;

    instanceRef.current?.toggleRuler();
    setRulerVisible(nextVisible);
  }

  function changeRulerUnit(unit: SuperDocMeasurementUnit) {
    if (unit === rulerUnit || state !== 'ready') return;

    instanceRef.current?.setMeasurementUnit(unit);
    setRulerUnit(unit);
  }

  async function resetModesDemo() {
    const instance = instanceRef.current;
    if (!instance || !fixture || modeResetBusy) return;

    setModeResetBusy(true);
    try {
      const result = await instance.replaceFile(await getFixtureFile());
      if (!documentReplacementSucceeded(result)) throw new Error('SuperDoc could not reset the sample document.');

      instance.setDocumentMode(documentMode);
    } catch {
      setState('error');
    } finally {
      if (mountedRef.current) setModeResetBusy(false);
    }
  }

  async function replayLoading() {
    const instance = instanceRef.current;
    if (!instance || !fixture || configurationBusy) return;

    setConfigurationBusy(true);
    setConfigurationError(null);
    try {
      const result = await instance.replaceFile(await getFixtureFile());
      if (!documentReplacementSucceeded(result)) throw new Error('SuperDoc could not reopen the sample document.');
    } catch {
      if (mountedRef.current) setConfigurationError('The document could not be reopened. Try again.');
    } finally {
      if (mountedRef.current) setConfigurationBusy(false);
    }
  }

  function handleViewingKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (documentMode !== 'viewing') return;

    const isTextInput = event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
    const isEditingKey = isTextInput || ['Backspace', 'Delete', 'Enter'].includes(event.key);
    if (!isEditingKey) return;

    event.preventDefault();
    const surface = event.currentTarget;
    surface.classList.remove('sd-editor-demo-surface-blocked');
    void surface.offsetWidth;
    surface.classList.add('sd-editor-demo-surface-blocked');
  }

  async function decideChange(decision: 'accept' | 'reject') {
    const ui = uiRef.current;
    if (!ui || !activeChangeId || reviewBusy) return;

    setReviewBusy(true);
    try {
      await Promise.resolve(ui.trackChanges[decision](activeChangeId));
    } finally {
      if (mountedRef.current) setReviewBusy(false);
    }
  }

  function changeZoom(direction: -1 | 1) {
    const nextZoom = Math.min(zoom.max, Math.max(zoom.min, zoom.value + direction * zoomStep));
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
    } catch {
      delete demo.dataset.fullscreen;
    }
  }

  const hasActiveChange = Boolean(activeChangeId) && !reviewBusy;
  const countLabel = `${trackedChangeCount} ${trackedChangeCount === 1 ? 'change' : 'changes'}`;
  const activeDocumentMode = documentModes.find((mode) => mode.id === documentMode) ?? documentModes[0];
  const contentControlStatus = lastContentControl
    ? `${lastContentControl.alias ?? lastContentControl.tag ?? lastContentControl.id} · tag: ${lastContentControl.tag ?? 'none'} · type: ${lastContentControl.controlType}`
    : 'Click a field to see its alias, tag, and type.';

  return (
    <section
      ref={demoRef}
      className='sd-editor-demo'
      aria-label={title}
      data-document-mode={preset === 'document-modes' || preset === 'search' ? documentMode : undefined}
      data-preset={preset}
      data-ruler-visible={preset === 'ruler' ? rulerVisible : undefined}
      data-state={state}
    >
      <div className='sd-editor-demo-header'>
        <div className='sd-editor-demo-copy'>
          <strong>{title}</strong>
          <span
            aria-live={
              preset === 'content-controls' ||
              preset === 'context-menu' ||
              preset === 'document-modes' ||
              preset === 'ruler'
                ? 'polite'
                : undefined
            }
          >
            {preset === 'document-modes'
              ? activeDocumentMode.note
              : allowLocalFile
                ? 'Loads the sample automatically. Files stay in this browser.'
                : preset === 'proofing'
                  ? 'Type “mispelled”, “workng”, or “teh”, then right-click its underline.'
                  : preset === 'comments'
                    ? 'Open the existing thread, then change its layout or available actions.'
                    : preset === 'content-controls'
                      ? contentControlStatus
                      : preset === 'context-menu'
                        ? (contextMenuActionStatus ?? 'Select text, then right-click to open the document menu.')
                        : preset === 'hyperlinks'
                          ? 'Click the hyperlink to try the selected activation behavior.'
                          : preset === 'loading'
                            ? 'Replay loading to see the built-in progress overlay during a document replacement.'
                            : preset === 'ruler'
                              ? getRulerHint(rulerActive)
                              : preset === 'search'
                                ? 'Search for “Client”, or include tracked deletions and search for “Legacy”.'
                                : preset === 'toolbar'
                                  ? 'Switch strategies, then try the rendered controls in the document.'
                                  : 'Loads the sample DOCX in suggesting mode.'}
          </span>
        </div>
        <div className='sd-editor-demo-actions'>
          {state === 'error' ? (
            <button type='button' onClick={loadDemo}>
              Try sample again
            </button>
          ) : (
            <span className='sd-editor-demo-status' aria-live='polite'>
              {state === 'ready' && !(preset === 'loading' && configurationBusy) ? 'Ready' : 'Loading…'}
            </span>
          )}
          {preset === 'loading' && state === 'ready' ? (
            <button type='button' disabled={configurationBusy} onClick={() => void replayLoading()}>
              Replay loading
            </button>
          ) : null}
          {allowLocalFile ? (
            <>
              <button
                className='sd-editor-demo-file-button'
                type='button'
                onClick={openFilePicker}
                disabled={state === 'loading'}
              >
                Open your DOCX
              </button>
              <input
                ref={fileInputRef}
                className='sd-editor-demo-file-input'
                hidden
                type='file'
                accept='.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                onChange={(event) => {
                  loadLocalFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
            </>
          ) : null}
        </div>
      </div>
      {preset === 'toolbar' ||
      preset === 'search' ||
      preset === 'comments' ||
      preset === 'content-controls' ||
      preset === 'context-menu' ||
      preset === 'hyperlinks' ||
      preset === 'ruler' ||
      preset === 'document-modes' ? (
        <div className='sd-editor-demo-config-bar' aria-label={`${title} configuration`}>
          {preset === 'document-modes' ? (
            <div className='sd-editor-demo-mode-controls'>
              <DemoConfigGroup
                disabled={state !== 'ready' || modeResetBusy}
                label='Mode'
                onChange={changeDocumentMode}
                options={documentModes}
                value={documentMode}
              />
              {documentMode === 'viewing' ? (
                <DemoConfigGroup
                  disabled={state !== 'ready' || modeResetBusy}
                  label='Changes'
                  onChange={changeViewingTrackedChanges}
                  options={viewingTrackedChangesModes}
                  value={viewingTrackedChanges}
                />
              ) : null}
              <button
                className='sd-editor-demo-config-reset'
                type='button'
                aria-label='Reset the sample document'
                title='Reset the sample document'
                disabled={state !== 'ready' || modeResetBusy}
                onClick={() => void resetModesDemo()}
              >
                <RotateCcw aria-hidden='true' />
              </button>
            </div>
          ) : null}
          {preset === 'toolbar' ? (
            <DemoConfigGroup
              disabled={state !== 'ready' || configurationBusy}
              label='Toolbar'
              onChange={changeToolbarStrategy}
              options={toolbarDemoStrategies}
              value={toolbarStrategy}
            />
          ) : null}
          {preset === 'search' ? (
            <>
              <DemoConfigGroup
                disabled={state !== 'ready' || configurationBusy}
                label='Mode'
                onChange={(mode) => changeDocumentMode(mode)}
                options={searchDocumentModes}
                value={documentMode === 'viewing' ? 'viewing' : 'editing'}
              />
              <DemoConfigGroup
                disabled={state !== 'ready' || configurationBusy}
                label='Replace controls'
                onChange={changeSearchReplaceControls}
                options={[
                  { id: 'show', label: 'Show' },
                  { id: 'hide', label: 'Hide' },
                ]}
                value={replaceControls ? 'show' : 'hide'}
              />
              <DemoConfigGroup
                disabled={state !== 'ready' || configurationBusy}
                label='Tracked deletions'
                onChange={changeSearchTrackedDeletions}
                options={[
                  { id: 'exclude', label: 'Exclude' },
                  { id: 'include', label: 'Include' },
                ]}
                value={includeTrackedDeletions ? 'include' : 'exclude'}
              />
            </>
          ) : null}
          {preset === 'comments' ? (
            <>
              <DemoConfigGroup
                disabled={state !== 'ready' || configurationBusy}
                label='Layout'
                onChange={changeCommentsLayout}
                options={commentsDemoLayouts}
                value={commentsLayout}
              />
              <DemoConfigGroup
                disabled={state !== 'ready' || configurationBusy}
                label='Actions'
                onChange={changeCommentsLevel}
                options={commentsDemoLevels}
                value={commentsLevel}
              />
            </>
          ) : null}
          {preset === 'content-controls' ? (
            <DemoConfigGroup
              disabled={state !== 'ready' || configurationBusy}
              label='Built-in chrome'
              onChange={changeContentControlChrome}
              options={[
                { id: 'show', label: 'Show' },
                { id: 'hide', label: 'Hide' },
              ]}
              value={contentControlChrome ? 'show' : 'hide'}
            />
          ) : null}
          {preset === 'context-menu' ? (
            <DemoConfigGroup
              disabled={state !== 'ready' || configurationBusy}
              label='Menu'
              onChange={changeContextMenuStrategy}
              options={contextMenuDemoStrategies}
              value={contextMenuStrategy}
            />
          ) : null}
          {preset === 'hyperlinks' ? (
            <DemoConfigGroup
              disabled={state !== 'ready' || configurationBusy}
              label='Activation'
              onChange={changeHyperlinkBehavior}
              options={hyperlinkDemoBehaviors}
              value={hyperlinkBehavior}
            />
          ) : null}
          {preset === 'ruler' ? (
            <>
              <DemoConfigGroup
                disabled={state !== 'ready'}
                label='Ruler'
                onChange={changeRulerVisibility}
                options={[
                  { id: 'show', label: 'Show' },
                  { id: 'hide', label: 'Hide' },
                ]}
                value={rulerVisible ? 'show' : 'hide'}
              />
              <DemoConfigGroup
                disabled={state !== 'ready'}
                label='Measurements'
                onChange={changeRulerUnit}
                options={[
                  { id: 'in', label: 'Inches' },
                  { id: 'cm', label: 'Centimeters' },
                ]}
                value={rulerUnit}
              />
            </>
          ) : null}
          <EditorDemoViewControls
            disabled={state !== 'ready' || modeResetBusy}
            fitActive={fitActive}
            isFullscreen={isFullscreen}
            onFit={fitToWidth}
            onFullscreen={() => void toggleFullscreen()}
            onZoom={changeZoom}
            zoom={zoom}
          />
        </div>
      ) : null}
      <CollapsibleEditorPreview
        className='sd-editor-demo-preview'
        onCollapse={() => mountRef.current?.scrollTo({ top: 0 })}
      >
        {state === 'error' ? (
          <p className='sd-editor-demo-error' role='alert'>
            {allowLocalFile
              ? 'The editor could not load. Try the sample again or choose a local DOCX to continue.'
              : preset === 'proofing'
                ? 'The proofing editor could not load. Try again.'
                : preset === 'comments'
                  ? 'The comments editor could not load. Try again.'
                  : preset === 'content-controls'
                    ? 'The content-controls editor could not load. Try again.'
                    : preset === 'context-menu'
                      ? 'The context-menu editor could not load. Try again.'
                      : preset === 'hyperlinks'
                        ? 'The hyperlinks editor could not load. Try again.'
                        : preset === 'loading'
                          ? 'The loading UI demo could not open the document. Try again.'
                          : preset === 'ruler'
                            ? 'The ruler editor could not load. Try again.'
                            : preset === 'search'
                              ? 'The search editor could not load. Try again.'
                              : preset === 'toolbar'
                                ? 'The toolbar editor could not load. Try again.'
                                : 'The editor could not load. Download the fixture and continue with the local quickstart below.'}
          </p>
        ) : null}
        {configurationError ? (
          <p className='sd-editor-demo-error' role='alert'>
            {configurationError}
          </p>
        ) : null}
        {preset === 'hyperlinks' || preset === 'search' || preset === 'toolbar' ? (
          <div
            ref={toolbarRef}
            className='sd-editor-demo-built-in-toolbar'
            hidden={state === 'idle'}
            aria-label='Built-in Editor toolbar'
            aria-busy={configurationBusy}
            inert={configurationBusy}
          />
        ) : null}
        <div
          className='sd-editor-demo-toolbar'
          hidden={
            state === 'idle' ||
            preset === 'comments' ||
            preset === 'content-controls' ||
            preset === 'context-menu' ||
            preset === 'hyperlinks' ||
            preset === 'ruler' ||
            preset === 'search' ||
            preset === 'toolbar'
          }
          aria-label='Editor controls'
        >
          <div className='sd-editor-demo-toolbar-group sd-editor-demo-edit-controls' role='group' aria-label='Edit'>
            <button
              type='button'
              aria-label='Undo'
              disabled={!commandStates.undo.enabled}
              onClick={() => runCommand('undo')}
            >
              <Undo2 aria-hidden='true' />
            </button>
            <span className='sd-editor-demo-toolbar-separator' aria-hidden='true' />
            <button
              type='button'
              aria-label='Bold'
              aria-pressed={commandStates.bold.active}
              disabled={!commandStates.bold.enabled}
              onClick={() => runCommand('bold')}
            >
              <Bold aria-hidden='true' />
            </button>
            <button
              type='button'
              aria-label='Italic'
              aria-pressed={commandStates.italic.active}
              disabled={!commandStates.italic.enabled}
              onClick={() => runCommand('italic')}
            >
              <Italic aria-hidden='true' />
            </button>
            <button
              type='button'
              aria-label='Underline'
              aria-pressed={commandStates.underline.active}
              disabled={!commandStates.underline.enabled}
              onClick={() => runCommand('underline')}
            >
              <Underline aria-hidden='true' />
            </button>
          </div>
          {preset === 'tracked-review' ? (
            <div
              className='sd-editor-demo-toolbar-group sd-editor-demo-review-controls'
              role='group'
              aria-label='Review'
            >
              <button
                className='sd-editor-demo-accept-button'
                type='button'
                disabled={!hasActiveChange}
                onClick={() => void decideChange('accept')}
              >
                <Check aria-hidden='true' />
                Accept
              </button>
              <button type='button' disabled={!hasActiveChange} onClick={() => void decideChange('reject')}>
                <X aria-hidden='true' />
                Reject
              </button>
              <span className='sd-editor-demo-change-count' aria-live='polite'>
                {countLabel}
              </span>
            </div>
          ) : null}
          {preset !== 'document-modes' ? (
            <EditorDemoViewControls
              disabled={state !== 'ready'}
              fitActive={fitActive}
              isFullscreen={isFullscreen}
              onFit={fitToWidth}
              onFullscreen={() => void toggleFullscreen()}
              onZoom={changeZoom}
              zoom={zoom}
            />
          ) : null}
        </div>
        <div
          ref={mountRef}
          className='sd-editor-demo-surface'
          hidden={state === 'idle'}
          aria-busy={configurationBusy && preset !== 'loading'}
          inert={configurationBusy && preset !== 'loading'}
          tabIndex={preset === 'document-modes' && documentMode === 'viewing' ? -1 : undefined}
          onPointerDownCapture={() => {
            if (preset === 'document-modes' && documentMode === 'viewing') {
              mountRef.current?.focus({ preventScroll: true });
            }
          }}
          onKeyDownCapture={preset === 'document-modes' ? handleViewingKeyDown : undefined}
          onAnimationEnd={(event) => event.currentTarget.classList.remove('sd-editor-demo-surface-blocked')}
        />
        {state === 'idle' ? (
          <div className='sd-editor-demo-poster'>
            <span aria-hidden='true'>DOCX</span>
            <p>
              {allowLocalFile
                ? 'The sample editor loads as this demo enters view. You can also open your own DOCX.'
                : preset === 'proofing'
                  ? 'The proofing editor is loading.'
                  : preset === 'comments'
                    ? 'The comments editor is loading.'
                    : preset === 'content-controls'
                      ? 'The content-controls editor is loading.'
                      : preset === 'context-menu'
                        ? 'The context-menu editor is loading.'
                        : preset === 'hyperlinks'
                          ? 'The hyperlinks editor is loading.'
                          : preset === 'loading'
                            ? 'The document loading UI is loading.'
                            : preset === 'ruler'
                              ? 'The ruler editor is loading.'
                              : preset === 'search'
                                ? 'The search editor is loading.'
                                : preset === 'toolbar'
                                  ? 'The toolbar editor is loading.'
                                  : 'The sample editor loads as this demo enters view. The rest of the article stays lightweight.'}
            </p>
          </div>
        ) : null}
      </CollapsibleEditorPreview>
    </section>
  );
}
