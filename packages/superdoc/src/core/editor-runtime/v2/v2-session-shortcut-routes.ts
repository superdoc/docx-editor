// v2-keyboard-005 — Durable public routes for the v2 shell/session/reference
// keyboard shortcuts.
//
// The keyboard trigger plumbing lives in `@superdoc/v2-host`
// (`bindV2SessionShortcuts`). This module supplies the SHELL/PUBLIC routes those
// shortcuts call, so the keyboard layer never reaches V1 editor internals:
//
//   • toolbar focus  -> shell chrome (the built-in toolbar container)
//   • field update   -> the public Document API reference workflow facade
//   • page-field      -> the built-in page-number command for PAGE; the public
//                        Document API `fields.insert` workflow for NUMPAGES
//
// Header/footer focus and Escape session exit are intentionally NOT provided:
// the public V2 host exposes no story-focus or session-exit seam yet, so those
// routes stay absent and the binder fails closed with a stable diagnostic rather
// than fabricating behavior.

import { isPlainObject } from '../../../helpers/object-guards.js';

/**
 * The narrow slice of the public Document API facade (`activeEditor.doc`) the
 * reference shortcuts route through. Every method is optional so capability is
 * detected per facade rather than assumed.
 */
interface ReferenceDocumentApi {
  selection?: {
    current?: (input?: unknown) => unknown;
  };
  toc?: {
    list?: () => unknown;
    update?: (input: unknown) => unknown;
  };
  fields?: {
    list?: () => unknown;
    rebuild?: (input: unknown) => unknown;
    insert?: (input: unknown) => unknown;
  };
  index?: {
    list?: () => unknown;
    rebuild?: (input: unknown) => unknown;
  };
}

interface SessionShortcutRouteResult {
  handled: boolean;
  reason?: string;
}

type RouteReturn = SessionShortcutRouteResult | boolean;

interface SessionShortcutRoutes {
  focusToolbar?: () => RouteReturn;
  focusHeaderFooter?: (region: 'header' | 'footer') => RouteReturn;
  exitSession?: () => RouteReturn;
  updateFields?: () => RouteReturn;
  insertPageField?: (kind: 'page' | 'numpages') => RouteReturn;
}

/** The built-in page-number command as the shortcut sees it. */
interface PageNumberCommandRoute {
  /** Whether the command can insert at the current selection. */
  isEnabled: () => boolean;
  /** Run the command as a first-party UI action. */
  execute: () => Promise<unknown>;
}

interface CreateV2SessionShortcutRoutesDeps {
  /** Resolve the live toolbar container element for this SuperDoc instance. */
  resolveToolbarElement: () => HTMLElement | null | undefined;
  /** Resolve the live public Document API facade, or null when unavailable. */
  getDocumentApi: () => ReferenceDocumentApi | null | undefined;
  /** Scope each first-party mutation after its asynchronous list has resolved. */
  runReferenceMutation?: (memberPath: 'toc.update' | 'fields.rebuild' | 'index.rebuild', input: unknown) => unknown;
  /**
   * The built-in page-number command. When present, the PAGE shortcut runs it,
   * so the shortcut and the toolbar control insert and place the caret the same way.
   */
  pageNumberCommand?: PageNumberCommandRoute;
}

const TOOLBAR_FOCUS_SELECTOR = '.superdoc-toolbar';

/** Normalize a public list result (`{ items: [...] }` or an array) to an array. */
function listItems(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object' && Array.isArray((result as { items?: unknown[] }).items)) {
    return (result as { items: unknown[] }).items;
  }
  return [];
}

/** A best-effort update target derived from a listed reference item. The durable
 *  `address` (carrying the node id that `toc.update` / `fields.rebuild` resolve
 *  against) is preferred over the ephemeral `handle` ref, which those ops cannot
 *  resolve. */
function targetOf(item: unknown): unknown {
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    return record.target ?? record.address ?? record.handle ?? item;
  }
  return item;
}

function isFn(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return Boolean(value && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function');
}

function isTextTarget(value: unknown): value is { kind: 'text'; segments: unknown[]; story?: unknown } {
  return isPlainObject(value) && value.kind === 'text' && Array.isArray(value.segments) && value.segments.length > 0;
}

function isHeaderFooterStory(story: unknown): boolean {
  return (
    isPlainObject(story) &&
    story.kind === 'story' &&
    (story.storyType === 'headerFooterSlot' || story.storyType === 'headerFooterPart')
  );
}

function resolveCurrentHeaderFooterTextTarget(doc: ReferenceDocumentApi): SessionShortcutRouteResult & {
  target?: { kind: 'text'; segments: unknown[]; story?: unknown };
} {
  if (!isFn(doc.selection?.current)) return { handled: false, reason: 'page-field-selection-unavailable' };
  let currentSelection: unknown;
  try {
    currentSelection = doc.selection.current({ includeText: false });
  } catch {
    return { handled: false, reason: 'page-field-selection-unavailable' };
  }
  if (isPromiseLike(currentSelection)) return { handled: false, reason: 'page-field-selection-async' };
  if (!isPlainObject(currentSelection) || !isTextTarget(currentSelection.target)) {
    return { handled: false, reason: 'page-field-selection-unavailable' };
  }
  if (!isHeaderFooterStory(currentSelection.target.story)) {
    return { handled: false, reason: 'page-field-context-unavailable' };
  }
  return { handled: true, target: currentSelection.target };
}

/**
 * List reference entries through the facade and rebuild/update each. Runs async
 * and best-effort: list/update may be sync or Promise-returning, and any
 * rejection is swallowed (the durability of the result is proven separately by
 * the Labs reference-workflow rows, not by this keyboard route).
 */
function runListThenApply(
  list: (() => unknown) | undefined,
  apply: ((input: unknown) => unknown) | undefined,
): boolean {
  if (!isFn(list) || !isFn(apply)) return false;
  void Promise.resolve()
    .then(() => list())
    .then((result) => {
      for (const item of listItems(result)) {
        try {
          void Promise.resolve(apply({ target: targetOf(item) })).catch(() => {});
        } catch {
          /* best-effort per item */
        }
      }
    })
    .catch(() => {});
  return true;
}

/**
 * Build the durable session/reference shortcut routes. Returned routes match the
 * `SessionShortcutRoutes` shape consumed by `bindV2SessionShortcuts`.
 */
export function createV2SessionShortcutRoutes(deps: CreateV2SessionShortcutRoutesDeps): SessionShortcutRoutes {
  const focusToolbar = (): RouteReturn => {
    const container = deps.resolveToolbarElement();
    if (!container) return { handled: false, reason: 'no-toolbar' };
    const inner =
      typeof container.matches === 'function' && container.matches(TOOLBAR_FOCUS_SELECTOR)
        ? container
        : ((container.querySelector?.(TOOLBAR_FOCUS_SELECTOR) as HTMLElement | null) ?? container);
    if (!inner) return { handled: false, reason: 'no-toolbar' };
    if (!inner.hasAttribute('tabindex')) inner.setAttribute('tabindex', '0');
    if (typeof inner.focus !== 'function') return { handled: false, reason: 'no-toolbar' };
    inner.focus();
    return true;
  };

  const updateFields = (): RouteReturn => {
    const doc = deps.getDocumentApi();
    if (!doc) return { handled: false, reason: 'document-api-unavailable' };
    // V1 `F9`: update TOCs first, then stat/reference fields, then indexes.
    const apply = (
      memberPath: 'toc.update' | 'fields.rebuild' | 'index.rebuild',
      mutation: ((input: unknown) => unknown) | undefined,
    ) =>
      isFn(mutation)
        ? (input: unknown) =>
            deps.runReferenceMutation ? deps.runReferenceMutation(memberPath, input) : mutation(input)
        : undefined;
    let ran = runListThenApply(doc.toc?.list, apply('toc.update', doc.toc?.update));
    ran = runListThenApply(doc.fields?.list, apply('fields.rebuild', doc.fields?.rebuild)) || ran;
    ran = runListThenApply(doc.index?.list, apply('index.rebuild', doc.index?.rebuild)) || ran;
    return ran ? true : { handled: false, reason: 'field-update-workflow-unavailable' };
  };

  const insertPageField = (kind: 'page' | 'numpages'): RouteReturn => {
    if (kind === 'page' && deps.pageNumberCommand) {
      if (!deps.pageNumberCommand.isEnabled()) return { handled: false, reason: 'page-field-context-unavailable' };
      void deps.pageNumberCommand.execute().catch(() => {});
      return true;
    }
    const doc = deps.getDocumentApi();
    if (!doc) return { handled: false, reason: 'document-api-unavailable' };
    if (!isFn(doc.fields?.insert)) return { handled: false, reason: 'page-field-insert-unavailable' };
    const target = resolveCurrentHeaderFooterTextTarget(doc);
    if (!target.handled || !target.target) {
      return { handled: false, reason: target.reason ?? 'page-field-context-unavailable' };
    }
    const instruction = kind === 'page' ? 'PAGE' : 'NUMPAGES';
    try {
      const result = doc.fields!.insert!({
        at: target.target,
        instruction,
        mode: 'raw',
      });
      if (isPromiseLike(result)) {
        void result.catch(() => {});
      } else if (isPlainObject(result) && result.success === false) {
        return { handled: false, reason: 'page-field-insert-failed' };
      }
    } catch {
      return { handled: false, reason: 'page-field-insert-failed' };
    }
    return true;
  };

  return { focusToolbar, updateFields, insertPageField };
}
