'use client';

import { FileSearch, LocateFixed, Sparkles, Trash2, WandSparkles, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { SuperDocVisualHandle, SuperDocVisualTarget, UIConfig } from 'superdoc';
import type { SelectionCapture, SelectionSlice, SelectionTarget, TextTarget, ZoomSlice } from 'superdoc/ui';
import { CollapsibleEditorPreview } from './collapsible-editor-preview';
import { EditorDemoViewControls } from './editor-demo-view-controls';
import { EDITOR_DEMO_FIT_WIDTH_PADDING, fitRuntimeEditorToWidth } from './editor-demo-zoom';
import { createRuntimeEditor, loadRuntime, type SuperDocInstance } from './superdoc-runtime';

const DEMO_DOCUMENT = '/fixtures/custom-selection-workflow.docx';
const NARROW_DEMO_WIDTH = 520;
const INITIAL_ZOOM = { max: 200, min: 10, mode: 'manual', value: 80 } satisfies ZoomSlice;
const PROMPT_GAP = 12;
const PROMPT_EDGE = 8;
const ESTIMATED_ACTION_BAR_WIDTH = 104;
const ESTIMATED_ACTION_BAR_HEIGHT = 40;
const ESTIMATED_COMPOSER_WIDTH = 304;
const ESTIMATED_COMPOSER_HEIGHT = 360;
const REVIEW_FINDING_NAMESPACE = 'urn:superdoc:docs:ai-review-findings:1';

type DemoState = 'idle' | 'loading' | 'ready' | 'error';
type DemoAnswer = { summary: string; suggestedText?: string };
type PromptPosition = { left: number; top: number };
type CustomSelectionDemoProps = { reviewFindings?: boolean };
type ReviewFindingPayload = {
  kind: 'risk';
  question: string;
  quote: string;
  summary: string;
  suggestedText?: string;
  suggestionStatus?: 'pending' | 'created';
};
type ReviewFinding = {
  anchorStatus: 'orphan' | 'resolved';
  id: string;
  payload: ReviewFindingPayload;
};

function isReviewFindingPayload(value: unknown): value is ReviewFindingPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ReviewFindingPayload>;
  return (
    candidate.kind === 'risk' &&
    typeof candidate.question === 'string' &&
    typeof candidate.quote === 'string' &&
    typeof candidate.summary === 'string' &&
    (candidate.suggestedText === undefined || typeof candidate.suggestedText === 'string') &&
    (candidate.suggestionStatus === undefined ||
      candidate.suggestionStatus === 'pending' ||
      candidate.suggestionStatus === 'created')
  );
}

function toSelectionTarget(target: SelectionTarget | TextTarget): SelectionTarget | null {
  if (target.kind === 'selection') return target.coordinateSpace === 'tracked' ? null : target;
  if (target.coordinateSpace === 'tracked' || target.segments.length === 0) return null;

  const first = target.segments[0];
  const last = target.segments[target.segments.length - 1];
  if (first.blockId !== last.blockId) return null;

  return {
    kind: 'selection',
    start: { kind: 'text', blockId: first.blockId, offset: first.range.start },
    end: { kind: 'text', blockId: last.blockId, offset: last.range.end },
    ...(target.story ? { story: target.story } : {}),
  };
}

function toVisualTargets(target: SelectionTarget | TextTarget): SuperDocVisualTarget[] {
  if (target.kind === 'text') {
    return target.segments.map((segment) => ({
      kind: 'text',
      blockId: segment.blockId,
      range: { start: segment.range.start, end: segment.range.end },
    }));
  }
  if (target.start.kind !== 'text' || target.end.kind !== 'text') return [];
  if (target.start.blockId !== target.end.blockId) return [];
  return [
    {
      kind: 'text',
      blockId: target.start.blockId,
      range: { start: target.start.offset, end: target.end.offset },
    },
  ];
}

// Restoration must not outrank a deliberate focus move. Hiding the card unmounts the focused
// control, so the browser parks focus on <body>; anything else holding it means the reader
// moved on, and keeping their place matters more than returning to the prompt.
function focusIsUnclaimed() {
  const active = document.activeElement;
  return active === null || active === document.body;
}

// The card remounts on scroll-back with fresh elements, so the reader's position is recorded
// as a control name rather than a node. Returning them to the textarea when they were on
// Close or Ask would make them navigate back to what they had already reached.
function promptControlName(card: HTMLElement | null): string | null {
  if (!card || !(document.activeElement instanceof HTMLElement)) return null;
  if (!card.contains(document.activeElement)) return null;
  return document.activeElement.closest('[data-prompt-control]')?.getAttribute('data-prompt-control') ?? '';
}

function focusPromptControl(card: HTMLElement | null, name: string | null): boolean {
  if (!card || !name) return false;
  const control = card.querySelector(`[data-prompt-control="${name}"]`);
  if (!(control instanceof HTMLElement)) return false;
  control.focus();
  return true;
}

function captureKey(capture: SelectionCapture) {
  return JSON.stringify([capture.selectionTarget ?? capture.target, capture.quotedText]);
}

function createDemoAnswer(selectedText: string, reviewFindings: boolean): DemoAnswer {
  if (selectedText.toLowerCase().includes('twelve months')) {
    return reviewFindings
      ? {
          summary: 'The cap may be near zero early in the agreement. Consider adding a fixed floor.',
          suggestedText: 'the greater of the fees Customer paid in the twelve months before the claim or USD 250,000',
        }
      : { summary: 'This clause caps liability at the fees the customer paid during the 12 months before the claim.' };
  }
  if (selectedText.toLowerCase().includes('sixty days')) {
    return { summary: 'Either party must give 60 days\u2019 written notice to prevent automatic renewal.' };
  }
  return { summary: `The selected text says: ${selectedText}` };
}

export function CustomSelectionDemo({ reviewFindings = false }: CustomSelectionDemoProps = {}) {
  const rootRef = useRef<HTMLElement>(null);
  const builtInToolbarRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const highlightLayerRef = useRef<SuperDocVisualHandle | null>(null);
  const observerCleanupRef = useRef<(() => void) | null>(null);
  const captureRef = useRef<SelectionCapture | null>(null);
  const captureKeyRef = useRef('');
  const ignoredCaptureKeyRef = useRef('');
  const loadIdRef = useRef(0);
  const refreshIdRef = useRef(0);
  const mutationEpochRef = useRef(0);
  const captureEpochRef = useRef(0);
  const mutationRefreshRunningRef = useRef(false);
  const mutationRefreshQueuedRef = useRef(false);
  const findingActionRef = useRef<symbol | null>(null);
  const suggestedFindingIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const composerOpenRef = useRef(false);
  const restoreActionFocusRef = useRef(false);
  // The composer keeps `isComposerOpen` true across a scroll-away, so visibility alone must
  // not refocus it: only opening it, or having owned focus when it was hidden, may.
  const restoreComposerFocusRef = useRef<string | null>(null);
  const wasComposerOpenRef = useRef(false);
  const zoomRef = useRef<ZoomSlice>(INITIAL_ZOOM);

  const [state, setState] = useState<DemoState>('idle');
  const [capture, setCapture] = useState<SelectionCapture | null>(null);
  const [promptPosition, setPromptPosition] = useState<PromptPosition | null>(null);
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState<DemoAnswer | null>(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const [pendingFindingId, setPendingFindingId] = useState<string | null>(null);
  const [isSavingFinding, setIsSavingFinding] = useState(false);
  const [suggestedFindingIds, setSuggestedFindingIds] = useState<ReadonlySet<string>>(new Set());
  const [interactionMessage, setInteractionMessage] = useState(
    reviewFindings
      ? 'Select the liability cap, ask what to review, then save the response.'
      : 'Select text in the document to ask AI about it.',
  );
  const [geometryMessage, setGeometryMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState<ZoomSlice>(INITIAL_ZOOM);

  const positionPrompt = useCallback((nextCapture = captureRef.current) => {
    const instance = instanceRef.current;
    const documentElement = documentRef.current;
    const editorElement = mountRef.current;
    const target = nextCapture?.selectionTarget ?? nextCapture?.target;
    if (!instance || !documentElement || !editorElement || !target) {
      setPromptPosition(null);
      return;
    }

    const geometry = instance.ui.viewport.getRect({ target, relativeTo: documentElement });
    if (!geometry.found || !geometry.rect) {
      setPromptPosition(null);
      setGeometryMessage('The captured text is not currently painted. Scroll it into view.');
      return;
    }

    const documentBounds = documentElement.getBoundingClientRect();
    const editorBounds = editorElement.getBoundingClientRect();
    const visibleTop = editorBounds.top - documentBounds.top;
    const visibleBottom = editorBounds.bottom - documentBounds.top;
    const visibleLeft = editorBounds.left - documentBounds.left;
    const visibleRight = editorBounds.right - documentBounds.left;
    const anchorRect = geometry.rects.find(
      (rect) =>
        rect.bottom >= visibleTop &&
        rect.top <= visibleBottom &&
        rect.right >= visibleLeft &&
        rect.left <= visibleRight,
    );
    if (!anchorRect) {
      setPromptPosition(null);
      setGeometryMessage('The captured text is outside the visible area. Scroll back to show its prompt.');
      return;
    }

    setGeometryMessage(null);

    const composerOpen = composerOpenRef.current;
    const promptWidth =
      promptRef.current?.offsetWidth ?? (composerOpen ? ESTIMATED_COMPOSER_WIDTH : ESTIMATED_ACTION_BAR_WIDTH);
    const promptHeight =
      promptRef.current?.offsetHeight ?? (composerOpen ? ESTIMATED_COMPOSER_HEIGHT : ESTIMATED_ACTION_BAR_HEIGHT);
    const preferredLeft = anchorRect.left + anchorRect.width / 2 - promptWidth / 2;
    const maxLeft = Math.max(PROMPT_EDGE, documentElement.clientWidth - promptWidth - PROMPT_EDGE);
    const minTop = visibleTop + PROMPT_EDGE;
    const maxTop = Math.max(minTop, visibleBottom - promptHeight - PROMPT_EDGE);
    const above = anchorRect.top - promptHeight - PROMPT_GAP;
    const below = anchorRect.bottom + PROMPT_GAP;
    const belowFits = below + promptHeight <= visibleBottom - PROMPT_EDGE;
    const preferredTop = composerOpen && belowFits ? below : above >= minTop ? above : below;

    setPromptPosition({
      left: Math.max(PROMPT_EDGE, Math.min(preferredLeft, maxLeft)),
      top: Math.max(minTop, Math.min(preferredTop, maxTop)),
    });
  }, []);

  const refreshFindings = useCallback(async (instance = instanceRef.current): Promise<boolean> => {
    const refreshId = (refreshIdRef.current += 1);
    const doc = instance?.activeEditor?.doc;
    const highlightLayer = highlightLayerRef.current;
    if (!doc || !highlightLayer) return false;

    try {
      const listed = await doc.metadata.list({ namespace: REVIEW_FINDING_NAMESPACE });
      const rows = await Promise.all(
        listed.items.map(async (item) => {
          const [record, resolved] = await Promise.all([
            doc.metadata.get({ id: item.id }),
            doc.metadata.resolve({ id: item.id }),
          ]);
          if (!record || !isReviewFindingPayload(record.payload)) return null;
          return {
            finding: { id: item.id, anchorStatus: item.anchorStatus, payload: record.payload } satisfies ReviewFinding,
            visualTargets: resolved ? toVisualTargets(resolved.target) : [],
          };
        }),
      );
      if (!mountedRef.current || refreshId !== refreshIdRef.current) return false;

      for (const row of rows) {
        if (row?.finding.payload.suggestionStatus === 'created') suggestedFindingIdsRef.current.add(row.finding.id);
      }
      setSuggestedFindingIds(new Set(suggestedFindingIdsRef.current));
      highlightLayer.replace(
        rows.flatMap((row) => (row && !suggestedFindingIdsRef.current.has(row.finding.id) ? row.visualTargets : [])),
      );
      setFindings(rows.flatMap((row) => (row ? [row.finding] : [])));
      return true;
    } catch (cause) {
      if (!mountedRef.current || refreshId !== refreshIdRef.current) return false;
      // The cached targets were resolved before the edit, so keeping them marks unrelated
      // text until some later refresh happens to succeed. Drop the paint and the rows.
      highlightLayer.replace([]);
      setFindings([]);
      setInteractionMessage(cause instanceof Error ? cause.message : 'The findings could not be refreshed.');
      return false;
    }
  }, []);

  // One mutation-driven refresh at a time with at most one queued: a typing burst otherwise
  // issues a listing plus a get and resolve per finding on every keystroke, and refreshIdRef
  // stops stale results publishing without cancelling the requests.
  const queueMutationRefresh = useCallback(() => {
    if (mutationRefreshRunningRef.current) {
      refreshIdRef.current += 1;
      mutationRefreshQueuedRef.current = true;
      return;
    }
    mutationRefreshRunningRef.current = true;
    void refreshFindings().finally(() => {
      mutationRefreshRunningRef.current = false;
      if (!mutationRefreshQueuedRef.current) return;
      mutationRefreshQueuedRef.current = false;
      queueMutationRefresh();
    });
  }, [refreshFindings]);

  const teardown = useCallback(() => {
    refreshIdRef.current += 1;
    observerCleanupRef.current?.();
    observerCleanupRef.current = null;
    instanceRef.current?.destroy();
    instanceRef.current = null;
    highlightLayerRef.current = null;
    captureRef.current = null;
    captureKeyRef.current = '';
    ignoredCaptureKeyRef.current = '';
    findingActionRef.current = null;
  }, []);

  const start = useCallback(async () => {
    const loadId = (loadIdRef.current += 1);
    const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
    const toolbarContainer = builtInToolbarRef.current;

    teardown();
    setState('loading');
    setCapture(null);
    setPromptPosition(null);
    setPrompt('');
    setAnswer(null);
    setFindings([]);
    setActiveFindingId(null);
    setPendingFindingId(null);
    setIsSavingFinding(false);
    suggestedFindingIdsRef.current.clear();
    setSuggestedFindingIds(new Set());
    composerOpenRef.current = false;
    setIsComposerOpen(false);
    setInteractionMessage(
      reviewFindings
        ? 'Select the liability cap, ask what to review, then save the response.'
        : 'Select text in the document to ask AI about it.',
    );
    setGeometryMessage(null);
    setLoadError('');
    zoomRef.current = INITIAL_ZOOM;
    setZoom(INITIAL_ZOOM);

    if (!toolbarContainer || !mountRef.current) {
      setState('error');
      setLoadError('The selection example could not be mounted.');
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
      const reviewFindingExtension = reviewFindings
        ? SuperDocCtor.defineSuperDocExtension({
            id: 'docs.aiReviewFindings',
            activate(ctx) {
              const layer = ctx.visuals.highlight('findings', {
                className: 'sd-review-finding-highlight',
                scope: 'text',
              });
              highlightLayerRef.current = layer;
              ctx.disposables.add(layer);
              ctx.disposables.add(
                ctx.onMutation({ affects: ['text', 'block'] }, () => {
                  mutationEpochRef.current += 1;
                  if (highlightLayerRef.current !== layer) return;
                  queueMutationRefresh();
                }),
              );
              return {
                dispose() {
                  if (highlightLayerRef.current === layer) highlightLayerRef.current = null;
                },
              };
            },
          })
        : null;

      const instance = createRuntimeEditor(SuperDocCtor, {
        selector: mountRef.current,
        document: DEMO_DOCUMENT,
        documentMode: 'editing',
        extensions: reviewFindingExtension ? [reviewFindingExtension] : undefined,
        ui: editorUi,
        ...(reviewFindings ? { user: { name: 'Review assistant', email: 'review-assistant@example.com' } } : {}),
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
          setState('ready');
          if (reviewFindings) void refreshFindings(superdoc);
        },
        onContentError: () => {
          if (!isCurrent()) return;
          teardown();
          setState('error');
          setLoadError('The selection document could not be read.');
        },
        onException: () => {
          if (!isCurrent()) return;
          setInteractionMessage('The editor reported a runtime error.');
        },
      });
      instanceRef.current = instance;

      const handleSelection = (selection: SelectionSlice) => {
        if (!isCurrent() || selection.status !== 'ready' || selection.empty) return;
        const nextCapture = instance.ui.selection.capture();
        if (!nextCapture) return;

        const nextKey = captureKey(nextCapture);
        if (nextKey === ignoredCaptureKeyRef.current) {
          ignoredCaptureKeyRef.current = '';
          return;
        }
        ignoredCaptureKeyRef.current = '';
        const targetChanged = nextKey !== captureKeyRef.current;
        captureRef.current = nextCapture;
        captureEpochRef.current = mutationEpochRef.current;
        captureKeyRef.current = nextKey;
        setCapture(nextCapture);
        if (targetChanged) {
          composerOpenRef.current = false;
          setIsComposerOpen(false);
          setPrompt('');
          setAnswer(null);
          setInteractionMessage('Selection captured. Choose Ask AI.');
        }
        positionPrompt(nextCapture);
      };

      const stopSelection = instance.ui.selection.observe(handleSelection);
      const stopViewport = instance.ui.viewport.observe(() => positionPrompt());
      const stopZoom = instance.ui.zoom.observe((snapshot) => {
        zoomRef.current = snapshot;
        if (isCurrent()) setZoom(snapshot);
      });
      observerCleanupRef.current = () => {
        stopSelection();
        stopViewport();
        stopZoom();
      };

      if (!isCurrent()) teardown();
    } catch (cause) {
      if (!isCurrent()) return;
      teardown();
      setState('error');
      setLoadError(cause instanceof Error ? cause.message : 'The selection example could not start.');
    }
  }, [positionPrompt, queueMutationRefresh, refreshFindings, reviewFindings, teardown]);

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

  const isPromptVisible = promptPosition !== null;
  useEffect(() => {
    if (!capture) return;
    const frame = requestAnimationFrame(() => positionPrompt(capture));
    return () => cancelAnimationFrame(frame);
  }, [answer, capture, isComposerOpen, isPromptVisible, positionPrompt]);

  // Record whether any prompt control — textarea, Close, Ask, Show selection — owned focus
  // just before the card unmounts, so a scroll-back restores it to the reader who had it
  // rather than pulling it from wherever it moved.
  useLayoutEffect(() => {
    if (!isPromptVisible) return undefined;
    return () => {
      restoreComposerFocusRef.current = promptControlName(promptRef.current);
    };
  }, [isPromptVisible]);

  useEffect(() => {
    // Same unmount-on-scroll shape as the documented snippet.
    const composerJustOpened = isComposerOpen && !wasComposerOpenRef.current;
    wasComposerOpenRef.current = isComposerOpen;
    if (!isPromptVisible) return;
    const restoreTarget = restoreComposerFocusRef.current;
    if (isComposerOpen) {
      if (!composerJustOpened && restoreTarget === null) return;
      restoreComposerFocusRef.current = null;
      if (composerJustOpened) {
        promptInputRef.current?.focus();
        return;
      }
      if (focusIsUnclaimed() && !focusPromptControl(promptRef.current, restoreTarget)) {
        promptInputRef.current?.focus();
      }
      return;
    }
    // The capture is card-wide, so the compact action button's ownership lands in the same
    // record; either signal restores this branch. Closing the composer is deliberate and always
    // lands focus; a scroll-back only reclaims focus that nobody else took.
    const closedComposer = restoreActionFocusRef.current;
    if (!closedComposer && restoreTarget === null) return;
    restoreActionFocusRef.current = false;
    restoreComposerFocusRef.current = null;
    if (closedComposer) {
      actionButtonRef.current?.focus();
      return;
    }
    if (focusIsUnclaimed() && !focusPromptControl(promptRef.current, restoreTarget)) {
      actionButtonRef.current?.focus();
    }
  }, [isComposerOpen, isPromptVisible]);

  function changeZoom(direction: -1 | 1) {
    const currentZoom = zoomRef.current;
    const nextZoom = Math.min(currentZoom.max, Math.max(currentZoom.min, currentZoom.value + direction * 10));
    instanceRef.current?.ui.zoom.set(nextZoom);
  }

  function fitToWidth() {
    if (instanceRef.current) fitRuntimeEditorToWidth(instanceRef.current);
  }

  function restoreSelection() {
    const currentCapture = captureRef.current;
    const ui = instanceRef.current?.ui;
    if (!currentCapture || !ui) return;

    const result = ui.selection.restore(currentCapture);
    setInteractionMessage(
      result.success
        ? 'Selection shown in the document.'
        : `Could not show the selection: ${result.reason ?? 'unknown'}.`,
    );
  }

  function openComposer() {
    if (!captureRef.current) return;
    restoreActionFocusRef.current = false;
    composerOpenRef.current = true;
    setIsComposerOpen(true);
    setInteractionMessage('The composer kept the captured text as context.');
  }

  function closeComposer() {
    restoreActionFocusRef.current = true;
    composerOpenRef.current = false;
    setIsComposerOpen(false);
    setPrompt('');
    setAnswer(null);
    setInteractionMessage('Selection captured. Choose Ask AI.');
  }

  function askAboutSelection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentCapture = captureRef.current;
    const question = prompt.trim();
    if (!currentCapture || !question) return;

    setAnswer(createDemoAnswer(currentCapture.quotedText, reviewFindings));
    setInteractionMessage('The local demo used the captured text as context.');
  }

  async function saveFinding() {
    const instance = instanceRef.current;
    const doc = instance?.activeEditor?.doc;
    const currentCapture = captureRef.current;
    const captureEpoch = captureEpochRef.current;
    const target = currentCapture?.target;
    const question = prompt.trim();
    if (!instance || !doc || !currentCapture || !target || !question || !answer || findingActionRef.current) {
      return;
    }
    if (!toSelectionTarget(target)) {
      setInteractionMessage('Select text inside one paragraph before saving the finding.');
      return;
    }
    // `ranges.resolve()` truncates its verification preview past 200 UTF-16 units, and
    // suggestFinding() treats a truncated preview as unverifiable.
    const captureLength =
      target.kind === 'text'
        ? target.segments.reduce((total, segment) => total + (segment.range.end - segment.range.start), 0)
        : 0;
    if (captureLength > 200) {
      setInteractionMessage('Select up to 200 characters so the suggestion can be verified.');
      return;
    }
    // The capture holds frozen offsets. An edit while the composer was open moves the text
    // under them, and the post-edit listing would otherwise bless the stale range.
    if (captureEpoch !== mutationEpochRef.current) {
      setInteractionMessage('The document changed after this text was selected. Select the text again.');
      return;
    }

    const action = Symbol();
    findingActionRef.current = action;
    setIsSavingFinding(true);
    try {
      const overlapping = await doc.metadata.list({ within: target });
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (captureEpoch !== mutationEpochRef.current) {
        setInteractionMessage('The document changed after this text was selected. Select the text again.');
        return;
      }
      if (overlapping.items.length > 0) {
        setInteractionMessage('That text already has an attached record. Select another range.');
        return;
      }

      const receipt = await doc.metadata.attach(
        {
          namespace: REVIEW_FINDING_NAMESPACE,
          target,
          payload: {
            kind: 'risk',
            question,
            quote: currentCapture.quotedText,
            summary: answer.summary,
            suggestedText: answer.suggestedText,
          } satisfies ReviewFindingPayload,
        },
        { expectedRevision: overlapping.evaluatedRevision },
      );
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (!receipt.success) {
        setInteractionMessage(receipt.failure.message);
        return;
      }

      ignoredCaptureKeyRef.current = captureKey(currentCapture);
      captureRef.current = null;
      captureKeyRef.current = '';
      composerOpenRef.current = false;
      setCapture(null);
      setIsComposerOpen(false);
      setPrompt('');
      setAnswer(null);
      setActiveFindingId(null);
      const refreshed = await refreshFindings(instance);
      if (mountedRef.current && refreshed) setInteractionMessage('Finding saved with the selected text.');
    } catch (cause) {
      if (mountedRef.current && instanceRef.current === instance && findingActionRef.current === action) {
        setInteractionMessage(cause instanceof Error ? cause.message : 'The finding could not be saved.');
      }
    } finally {
      if (findingActionRef.current === action) {
        findingActionRef.current = null;
        if (mountedRef.current && instanceRef.current === instance) setIsSavingFinding(false);
      }
    }
  }

  async function suggestFinding(finding: ReviewFinding) {
    const instance = instanceRef.current;
    const doc = instance?.activeEditor?.doc;
    if (!instance || !doc || !finding.payload.suggestedText || findingActionRef.current) return;

    const action = Symbol();
    findingActionRef.current = action;
    setPendingFindingId(finding.id);
    let releaseBeforeReplace: (() => Promise<void>) | undefined;
    try {
      const current = await doc.metadata.list({ namespace: REVIEW_FINDING_NAMESPACE });
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (!current.items.some((item) => item.id === finding.id)) {
        setInteractionMessage('That finding is no longer available.');
        await refreshFindings(instance);
        return;
      }

      const record = await doc.metadata.get({ id: finding.id });
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (!record || !isReviewFindingPayload(record.payload) || !record.payload.suggestedText) {
        setInteractionMessage('This finding no longer includes a suggested edit.');
        return;
      }
      if (record.payload.suggestionStatus) {
        setInteractionMessage('A suggestion was already requested. Check the document before creating another.');
        return;
      }
      const suggestedText = record.payload.suggestedText;
      const releaseReservation = async () => {
        releaseBeforeReplace = undefined;
        if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
        const current = await doc.metadata.list({ namespace: REVIEW_FINDING_NAMESPACE });
        const latest = await doc.metadata.get({ id: finding.id });
        if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
        if (
          latest &&
          isReviewFindingPayload(latest.payload) &&
          latest.payload.suggestionStatus === 'pending' &&
          latest.payload.suggestedText === suggestedText
        ) {
          const payload = { ...latest.payload };
          delete payload.suggestionStatus;
          const released = await doc.metadata.update(
            { id: finding.id, payload },
            { expectedRevision: current.evaluatedRevision },
          );
          if (!released.success) throw new Error(released.failure.message);
        }
      };
      const reserved = await doc.metadata.update(
        { id: finding.id, payload: { ...record.payload, suggestionStatus: 'pending' } },
        { expectedRevision: current.evaluatedRevision },
      );
      if (!reserved.success) {
        setInteractionMessage(reserved.failure.message);
        return;
      }
      releaseBeforeReplace = releaseReservation;
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      const afterReservation = await doc.metadata.list({ namespace: REVIEW_FINDING_NAMESPACE });
      const pending = await doc.metadata.get({ id: finding.id });
      const resolved = await doc.metadata.resolve({ id: finding.id });
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      // The reservation only pins status. Another writer can still change the quote before
      // these reads, and the verification below compares against the pre-reservation quote,
      // so a mismatch here would apply an edit the stored finding no longer describes.
      if (
        !pending ||
        !isReviewFindingPayload(pending.payload) ||
        pending.payload.suggestionStatus !== 'pending' ||
        pending.payload.suggestedText !== suggestedText ||
        pending.payload.quote !== record.payload.quote
      ) {
        // A quote-only change leaves our reservation in place, so clear it or the finding stays
        // durably pending and its action stays disabled. releaseReservation() no-ops when the
        // pending row is no longer ours.
        await releaseReservation();
        if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
        setInteractionMessage('The finding changed while requesting its suggestion. Check the document.');
        return;
      }
      const target = resolved ? toSelectionTarget(resolved.target) : null;
      if (!target) {
        await releaseReservation();
        if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
        setInteractionMessage('The finding is no longer anchored to editable text.');
        return;
      }

      const range = await doc.ranges.resolve({
        start: { kind: 'point', point: target.start },
        end: { kind: 'point', point: target.end },
        expectedRevision: afterReservation.evaluatedRevision,
      });
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (range.preview.truncated || range.preview.text !== record.payload.quote) {
        await releaseReservation();
        if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
        setInteractionMessage(
          range.preview.truncated
            ? 'The text is too long to verify. Ask AI about a shorter selection.'
            : 'The text changed since this finding was saved. Ask AI about the current text.',
        );
        return;
      }
      releaseBeforeReplace = undefined;
      const receipt = await doc.replace(
        { target, text: suggestedText },
        { changeMode: 'tracked', expectedRevision: afterReservation.evaluatedRevision },
      );
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (!receipt.success) {
        await releaseReservation();
        if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
        setInteractionMessage(receipt.failure?.message ?? 'The tracked suggestion could not be added.');
        return;
      }

      instance.ui.selection.apply({ ...target, end: target.start });
      const afterEdit = await doc.metadata.list({ namespace: REVIEW_FINDING_NAMESPACE });
      const latest = await doc.metadata.get({ id: finding.id });
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (!latest || !isReviewFindingPayload(latest.payload)) {
        setInteractionMessage('The edit was added, but its finding is no longer available.');
        return;
      }
      // Promoting to `created` records which quote the tracked replacement came from, so a quote
      // rewritten between `doc.replace()` and this read must not be marked as its source.
      if (
        latest.payload.suggestionStatus !== 'pending' ||
        latest.payload.suggestedText !== suggestedText ||
        latest.payload.quote !== record.payload.quote
      ) {
        setInteractionMessage('The edit was added, but the finding changed. Check the document.');
        return;
      }
      const recorded = await doc.metadata.update(
        { id: finding.id, payload: { ...latest.payload, suggestionStatus: 'created' } },
        { expectedRevision: afterEdit.evaluatedRevision },
      );
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (!recorded.success) {
        setInteractionMessage('The edit was added, but its status could not be saved. Check the document.');
        return;
      }
      suggestedFindingIdsRef.current.add(finding.id);
      setSuggestedFindingIds(new Set(suggestedFindingIdsRef.current));
      await refreshFindings(instance);
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      const currentCapture = instance.ui.selection.capture();
      ignoredCaptureKeyRef.current = currentCapture ? captureKey(currentCapture) : '';
      captureRef.current = null;
      captureKeyRef.current = '';
      setCapture(null);
      setPromptPosition(null);
      setActiveFindingId(null);
      setInteractionMessage('Tracked suggestion added. The finding keeps the reason for the edit.');
    } catch (cause) {
      try {
        await releaseBeforeReplace?.();
      } catch {
        if (mountedRef.current && instanceRef.current === instance && findingActionRef.current === action) {
          setInteractionMessage(
            'The suggestion was not sent, but its pending status could not be cleared. Check the document.',
          );
        }
        return;
      }
      if (mountedRef.current && instanceRef.current === instance && findingActionRef.current === action) {
        setInteractionMessage(cause instanceof Error ? cause.message : 'The tracked suggestion could not be added.');
      }
    } finally {
      if (findingActionRef.current === action) {
        findingActionRef.current = null;
        if (mountedRef.current && instanceRef.current === instance) setPendingFindingId(null);
        if (mountedRef.current && instanceRef.current === instance) await refreshFindings(instance);
      }
    }
  }

  async function showFinding(findingId: string) {
    const instance = instanceRef.current;
    const metadata = instance?.ui.metadata;
    if (!instance || !metadata || findingActionRef.current) return;

    const action = Symbol();
    findingActionRef.current = action;
    setPendingFindingId(findingId);
    try {
      const result = await metadata.scrollIntoView({ id: findingId, block: 'center' });
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (result.success) {
        setActiveFindingId(findingId);
        setInteractionMessage('Showing the finding in the document.');
      } else {
        setInteractionMessage('The finding is no longer anchored to visible text.');
      }
    } catch (cause) {
      if (mountedRef.current && instanceRef.current === instance && findingActionRef.current === action) {
        setInteractionMessage(cause instanceof Error ? cause.message : 'The finding could not be shown.');
      }
    } finally {
      if (findingActionRef.current === action) {
        findingActionRef.current = null;
        if (mountedRef.current && instanceRef.current === instance) setPendingFindingId(null);
      }
    }
  }

  async function removeFinding(findingId: string) {
    const instance = instanceRef.current;
    const doc = instance?.activeEditor?.doc;
    if (!instance || !doc || findingActionRef.current) return;

    const action = Symbol();
    findingActionRef.current = action;
    setPendingFindingId(findingId);
    try {
      const current = await doc.metadata.list({ namespace: REVIEW_FINDING_NAMESPACE });
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (!current.items.some((item) => item.id === findingId)) {
        setInteractionMessage('That finding is no longer available.');
        await refreshFindings(instance);
        return;
      }

      const receipt = await doc.metadata.remove({ id: findingId }, { expectedRevision: current.evaluatedRevision });
      if (!mountedRef.current || instanceRef.current !== instance || findingActionRef.current !== action) return;
      if (!receipt.success) {
        setInteractionMessage(receipt.failure.message);
        return;
      }

      if (activeFindingId === findingId) setActiveFindingId(null);
      suggestedFindingIdsRef.current.delete(findingId);
      setSuggestedFindingIds(new Set(suggestedFindingIdsRef.current));
      const refreshed = await refreshFindings(instance);
      if (mountedRef.current && refreshed) setInteractionMessage('Finding removed. The document text was kept.');
    } catch (cause) {
      if (mountedRef.current && instanceRef.current === instance && findingActionRef.current === action) {
        setInteractionMessage(cause instanceof Error ? cause.message : 'The finding could not be removed.');
      }
    } finally {
      if (findingActionRef.current === action) {
        findingActionRef.current = null;
        if (mountedRef.current && instanceRef.current === instance) setPendingFindingId(null);
      }
    }
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
      className={
        reviewFindings
          ? 'sd-custom-bold-demo sd-custom-selection-demo sd-custom-review-findings-demo'
          : 'sd-custom-bold-demo sd-custom-selection-demo'
      }
      data-custom-selection-demo
      data-custom-review-findings-demo={reviewFindings ? '' : undefined}
      data-state={state}
      ref={rootRef}
    >
      <div className='sd-custom-bold-demo-built-in sd-custom-selection-demo-built-in'>
        <div className='sd-custom-selection-demo-built-in-header'>
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
        className='sd-custom-selection-demo-preview'
        contentClassName={reviewFindings ? 'sd-custom-review-findings-workspace' : undefined}
        defaultExpanded
        expandedMaxHeight='72rem'
        onCollapse={() => mountRef.current?.scrollTo({ top: 0 })}
      >
        <div className='sd-custom-selection-demo-editor'>
          <div className='sd-custom-selection-demo-instruction'>
            <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
              Your application
            </span>
            <output aria-live='polite'>{geometryMessage ?? interactionMessage}</output>
          </div>

          <div className='sd-custom-selection-demo-document' ref={documentRef}>
            {loadError ? (
              <div className='sd-custom-bold-demo-error' role='alert'>
                <p>{loadError}</p>
                <button onClick={() => void start()} type='button'>
                  Try again
                </button>
              </div>
            ) : null}
            <div className='sd-custom-bold-demo-canvas sd-custom-selection-demo-canvas' ref={mountRef} />

            {capture && promptPosition ? (
              <aside
                aria-label={isComposerOpen ? 'Ask AI about selected text' : 'Actions for selected text'}
                className='sd-custom-selection-demo-card'
                data-mode={isComposerOpen ? 'composer' : 'actions'}
                ref={promptRef}
                role={isComposerOpen ? 'dialog' : undefined}
                style={{ left: promptPosition.left, top: promptPosition.top }}
              >
                {isComposerOpen ? (
                  <>
                    <div className='sd-custom-selection-demo-card-heading'>
                      <strong>
                        <Sparkles aria-hidden='true' size={14} />
                        Ask about this
                      </strong>
                      <button
                        aria-label='Close AI prompt'
                        className='sd-custom-selection-demo-close'
                        data-prompt-control='close'
                        onClick={closeComposer}
                        type='button'
                      >
                        <X aria-hidden='true' size={14} />
                      </button>
                    </div>
                    <p>“{capture.quotedText}”</p>
                    <form onSubmit={askAboutSelection}>
                      <label htmlFor='custom-selection-demo-prompt'>Ask about this selection</label>
                      <textarea
                        data-prompt-control='question'
                        id='custom-selection-demo-prompt'
                        onChange={(event) => {
                          setPrompt(event.target.value);
                          setAnswer(null);
                          setInteractionMessage('The prompt kept its captured document context.');
                        }}
                        placeholder='What does this limit?'
                        ref={promptInputRef}
                        rows={2}
                        value={prompt}
                      />
                      <div className='sd-custom-selection-demo-actions'>
                        <button
                          className='sd-custom-selection-demo-secondary'
                          data-prompt-control='show'
                          onClick={restoreSelection}
                          type='button'
                        >
                          <LocateFixed aria-hidden='true' size={14} />
                          Show selection
                        </button>
                        <button data-prompt-control='ask' disabled={!prompt.trim()} type='submit'>
                          Ask
                        </button>
                      </div>
                    </form>
                    {answer ? (
                      <>
                        <div className='sd-custom-selection-demo-answer'>
                          <strong>Simulated response</strong>
                          <span>{answer.summary}</span>
                        </div>
                        {reviewFindings ? (
                          <div className='sd-custom-selection-demo-actions'>
                            <button
                              className='sd-custom-selection-demo-secondary'
                              data-prompt-control='dismiss'
                              disabled={isSavingFinding}
                              onClick={closeComposer}
                              type='button'
                            >
                              Dismiss
                            </button>
                            <button
                              data-prompt-control='save'
                              disabled={isSavingFinding}
                              onClick={() => void saveFinding()}
                              type='button'
                            >
                              {isSavingFinding ? 'Saving…' : 'Save as finding'}
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : (
                  <div className='sd-custom-selection-demo-action-bar'>
                    <button
                      aria-haspopup='dialog'
                      data-prompt-control='action'
                      onClick={openComposer}
                      ref={actionButtonRef}
                      type='button'
                    >
                      <Sparkles aria-hidden='true' size={14} />
                      Ask AI
                    </button>
                  </div>
                )}
              </aside>
            ) : null}
          </div>
        </div>

        {reviewFindings ? (
          <aside className='sd-custom-review-findings-panel' aria-labelledby='custom-review-findings-heading'>
            <header>
              <span aria-hidden='true' className='sd-custom-bold-demo-owner'>
                Your application
              </span>
              <h3 id='custom-review-findings-heading'>AI review</h3>
              <p>
                {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
              </p>
            </header>

            {findings.length === 0 ? (
              <div className='sd-custom-review-findings-empty'>
                <FileSearch aria-hidden='true' size={20} />
                <p>Save an AI response to keep it with the selected text.</p>
              </div>
            ) : (
              <ul className='sd-custom-review-findings-list'>
                {findings.map((finding) => (
                  <li aria-current={finding.id === activeFindingId ? 'true' : undefined} key={finding.id}>
                    <div>
                      <strong>Risk</strong>
                      <span data-status={suggestedFindingIds.has(finding.id) ? 'suggested' : finding.anchorStatus}>
                        {suggestedFindingIds.has(finding.id)
                          ? 'Suggestion added'
                          : finding.payload.suggestionStatus === 'pending'
                            ? 'Check document'
                            : finding.anchorStatus === 'resolved'
                              ? 'Saved'
                              : 'Anchor missing'}
                      </span>
                    </div>
                    <blockquote>“{finding.payload.quote}”</blockquote>
                    <p>{finding.payload.summary}</p>
                    <div>
                      <button
                        disabled={pendingFindingId !== null || finding.anchorStatus !== 'resolved'}
                        onClick={() => void showFinding(finding.id)}
                        type='button'
                      >
                        <LocateFixed aria-hidden='true' size={14} />
                        Show in document
                      </button>
                      {finding.payload.suggestedText ? (
                        <button
                          className='sd-custom-review-findings-primary'
                          disabled={
                            pendingFindingId !== null ||
                            suggestedFindingIds.has(finding.id) ||
                            finding.payload.suggestionStatus !== undefined ||
                            finding.anchorStatus !== 'resolved'
                          }
                          onClick={() => void suggestFinding(finding)}
                          type='button'
                        >
                          <WandSparkles aria-hidden='true' size={14} />
                          {suggestedFindingIds.has(finding.id)
                            ? 'Suggested'
                            : finding.payload.suggestionStatus === 'pending'
                              ? 'Check document'
                              : 'Suggest edit'}
                        </button>
                      ) : null}
                      <button
                        aria-label='Remove finding'
                        disabled={pendingFindingId !== null}
                        onClick={() => void removeFinding(finding.id)}
                        type='button'
                      >
                        <Trash2 aria-hidden='true' size={14} />
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        ) : null}
      </CollapsibleEditorPreview>
    </figure>
  );
}

export function CustomReviewFindingsDemo() {
  return <CustomSelectionDemo reviewFindings />;
}
