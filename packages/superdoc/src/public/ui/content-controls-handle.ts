import { isObjectRecord, isPlainObject } from '../../helpers/object-guards.js';
import { hostMethod, rectFailure, safeCall } from './command-results.js';
import { readContentControlRequestId, readSelectionTarget } from './entity-rows.js';
import { isContentControlClickPayload } from './host-events.js';
import { readRecord, type LooseRecord } from './loose-record.js';
import { SUPERDOC_UI_REASONS } from './reasons.js';
import type {
  ContentControlClickPayload,
  ContentControlFocusResult,
  ContentControlHighlightResult,
  ContentControlInfo,
  ContentControlsHandle,
  ContentControlsSlice,
  ScrollIntoViewInput,
  ScrollIntoViewOutput,
  SelectionTarget,
  SnapshotSubscribable,
  Subscribable,
  SuperDocUIState,
  ViewportRectResult,
  WorkflowActionResult,
  WorkflowScrollResult,
} from './types.js';

type ScrollPlacement = { block?: ScrollIntoViewInput['block']; behavior?: ScrollIntoViewInput['behavior'] };

export interface ContentControlsHandleDeps {
  superdoc: unknown;
  select: (
    selector: (state: Pick<SuperDocUIState, 'contentControls'>) => ContentControlsSlice,
  ) => Subscribable<ContentControlsSlice>;
  snapshotHandle: (sub: Subscribable<ContentControlsSlice>) => SnapshotSubscribable<ContentControlsSlice>;
  leasedDirectorySnapshot: (
    passive: Subscribable<ContentControlsSlice>,
    directory: Subscribable<ContentControlsSlice>,
  ) => SnapshotSubscribable<ContentControlsSlice>;
  directoryLeaseHeld: () => boolean;
  demandCatalog: () => void;
  isDisposed: () => boolean;
  currentEditor: () => LooseRecord | null;
  currentHost: () => LooseRecord | null;
  documentContentControls: () => unknown;
  rectOf: (target: SelectionTarget) => ViewportRectResult;
  scrollIntoView: (target: SelectionTarget, placement: ScrollPlacement) => Promise<WorkflowScrollResult>;
  applySelection: (target: SelectionTarget) => WorkflowActionResult;
  activateChrome: (id: string) => void;
  onDocumentReset: (hook: () => void) => void;
  onDestroy: (detach: () => void) => void;
}

export interface ContentControlsController {
  handle: ContentControlsHandle;
  clearHighlight: () => void;
  clearClickListeners: () => void;
}

function anchoredSelectionTarget(control: ContentControlInfo): SelectionTarget | null {
  const target = isObjectRecord(control) ? control.selectionTarget : null;
  return typeof target === 'object' && target !== null ? target : null;
}

function collapseToCaret(target: SelectionTarget): SelectionTarget | null {
  if (target.kind !== 'selection') return target;
  const start = target.start;
  if (!isObjectRecord(start)) return null;
  return { ...target, end: start };
}

function hasId(row: unknown, id: string): boolean {
  if (row === undefined || row === null) throw new TypeError('contentControls.list returned an empty row');
  return (typeof row === 'object' || typeof row === 'function') && Reflect.get(row, 'id') === id;
}

function catalogRow(catalog: unknown, id: string): unknown {
  const rows = isPlainObject(catalog) ? catalog.items : undefined;
  if (rows === undefined || rows === null) return undefined;
  const find = hostMethod(rows, 'find');
  if (!find) throw new TypeError('contentControls.list returned items without find');
  return find((row: unknown) => hasId(row, id));
}

function requireMethod(target: unknown, name: string): (...args: unknown[]) => unknown {
  const method = hostMethod(target, name);
  if (!method) throw new TypeError(`${name} is not callable`);
  return method;
}

export function createContentControlsHandle(deps: ContentControlsHandleDeps): ContentControlsController {
  const passive = deps.select((s) => s.contentControls);
  const renewedWhileLeased = deps.select((s) => {
    if (deps.directoryLeaseHeld()) deps.demandCatalog();
    return s.contentControls;
  });
  const directory = deps.leasedDirectorySnapshot(passive, renewedWhileLeased);
  const activePathWithoutLease = deps.snapshotHandle(passive);

  const findLoaded = (id: string): ContentControlInfo | null =>
    passive.get().items.find((item) => item?.id === id) ?? null;

  const demandAndFind = (input: unknown): ContentControlInfo | null => {
    const id = readContentControlRequestId(input);
    if (!id) return null;
    deps.demandCatalog();
    return findLoaded(id);
  };

  function get(): ContentControlsSlice;
  function get(input: { id: string }): ContentControlInfo | null;
  function get(input?: { id: string }): ContentControlsSlice | ContentControlInfo | null {
    if (input === undefined) return directory.get();
    deps.demandCatalog();
    const id = readContentControlRequestId(input);
    return id ? findLoaded(id) : null;
  }

  let highlightGeneration = 0;
  let highlightedHost: LooseRecord | null = null;
  const clearHighlight = (): void => {
    highlightGeneration += 1;
    const host = highlightedHost ?? deps.currentHost();
    highlightedHost = null;
    safeCall(() => hostMethod(host, 'clearContentControlHighlight')?.(), undefined);
  };
  deps.onDocumentReset(clearHighlight);

  const highlight = async (input: { id: string }): Promise<ContentControlHighlightResult> => {
    const id = readContentControlRequestId(input);
    if (!id) return { success: false, reason: 'invalid-id' };
    const host = deps.currentHost();
    const editor = deps.currentEditor();
    const controls = deps.documentContentControls();
    if (deps.isDisposed() || !host || !hostMethod(host, 'highlightContentControl') || !hostMethod(controls, 'list')) {
      return { success: false, reason: 'not-ready' };
    }
    const request = ++highlightGeneration;
    highlightedHost = host;
    safeCall(() => hostMethod(host, 'cancelContentControlHighlightRequest')?.(), undefined);
    const superseded = (): boolean =>
      deps.isDisposed() || request !== highlightGeneration || editor !== deps.currentEditor();
    try {
      const catalog = await requireMethod(controls, 'list')();
      if (superseded()) return { success: false, reason: 'cancelled' };
      const control = catalogRow(catalog, id);
      if (!control) return { success: false, reason: 'not-found' };
      const target = readSelectionTarget(control);
      if (!target || readRecord(control)?.isEmpty) return { success: false, reason: 'not-reachable' };
      const painted = await requireMethod(host, 'highlightContentControl')(id, target);
      if (superseded()) return { success: false, reason: 'cancelled' };
      return painted ? { success: true } : { success: false, reason: 'not-reachable' };
    } catch {
      return { success: false, reason: superseded() ? 'cancelled' : 'not-reachable' };
    }
  };

  const clickListeners = new Set<(payload: ContentControlClickPayload) => void>();
  const on = hostMethod(deps.superdoc, 'on');
  if (on) {
    const forwardClick = (payload: unknown): void => {
      if (!isContentControlClickPayload(payload)) return;
      for (const listener of Array.from(clickListeners)) safeCall(() => listener(payload), undefined);
    };
    on('content-control:click', forwardClick);
    deps.onDestroy(() => {
      hostMethod(deps.superdoc, 'off')?.('content-control:click', forwardClick);
    });
  }

  const scrollToAnchor = async (input: { id: string } & ScrollPlacement): Promise<ScrollIntoViewOutput> => {
    const control = demandAndFind(input);
    const target = control ? anchoredSelectionTarget(control) : null;
    if (!target) return { success: false };
    const result = await deps.scrollIntoView(target, { block: input.block, behavior: input.behavior });
    return { success: result.ok };
  };

  const focus = async (input: { id: string } & ScrollPlacement): Promise<ContentControlFocusResult> => {
    const id = readContentControlRequestId(input);
    if (!id) return { success: false, reason: 'invalid-id' };
    if (!deps.currentEditor()) return { success: false, reason: 'not-ready' };
    deps.demandCatalog();
    const control = findLoaded(id);
    if (!control) return { success: false, reason: 'not-found' };
    const target = anchoredSelectionTarget(control);
    if (!target) return { success: false, reason: 'not-reachable' };
    const scrolled = await deps.scrollIntoView(target, { block: input.block, behavior: input.behavior });
    if (!scrolled.ok) return { success: false, reason: 'not-reachable' };
    const caret = collapseToCaret(target);
    if (!caret) return { success: false, reason: 'not-reachable' };
    const applied = deps.applySelection(caret);
    if (!applied.ok && applied.reason !== SUPERDOC_UI_REASONS.hostCapabilityUnavailable) {
      return { success: false, reason: 'not-reachable' };
    }
    const editor = deps.currentEditor();
    const host = deps.currentHost();
    const readiness = editor?.documentMutationReadiness;
    if (hostMethod(readiness, 'whenPainted')) {
      try {
        await requireMethod(readiness, 'whenPainted')();
      } catch {
        return { success: false, reason: 'not-reachable' };
      }
      if (deps.currentEditor() !== editor || deps.currentHost() !== host) {
        return { success: false, reason: 'not-ready' };
      }
    }
    const mounted = hostMethod(host, 'getMountedHandle')?.();
    hostMethod(isPlainObject(mounted) ? mounted.focus : undefined, 'focus')?.({ preventScroll: true });
    deps.activateChrome(id);
    return { success: true };
  };

  const handle: ContentControlsHandle = {
    clearHighlight,
    highlight,
    get,
    getSnapshot: directory.getSnapshot,
    subscribe: directory.subscribe,
    observe: directory.observe,
    observeActivePath: activePathWithoutLease.observe,
    onClick: (listener) => {
      if (deps.isDisposed()) return () => {};
      clickListeners.add(listener);
      return () => clickListeners.delete(listener);
    },
    list: () => {
      deps.demandCatalog();
      return passive.get().items;
    },
    getById: (id) => {
      deps.demandCatalog();
      return findLoaded(id);
    },
    getRect: (input) => {
      const id = readContentControlRequestId(input);
      if (!id) return rectFailure('unresolved');
      deps.demandCatalog();
      const control = findLoaded(id);
      if (!control) return rectFailure('unresolved');
      const target = anchoredSelectionTarget(control);
      if (!target) return rectFailure('unavailable');
      return deps.rectOf(target);
    },
    scrollIntoView: scrollToAnchor,
    focus,
  };

  return { handle, clearHighlight, clearClickListeners: () => clickListeners.clear() };
}
