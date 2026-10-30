import { markRaw } from 'vue';
import type { HyperlinkTarget, TextAddress } from '@superdoc/document-api';
import LinkInput from '../internal/toolbar/built-in/LinkInput.vue';
import { scrollToElement } from '../internal/toolbar/built-in/scroll-helpers.js';
import { isPlainObject } from '../helpers/object-guards.js';
import type { SurfaceManager } from '../core/surface-manager.js';
import type {
  DirectSurfaceRequest,
  DocumentMode,
  Editor,
  ExternalSurfaceRenderContext,
  HyperlinkActivationContext,
  HyperlinkActivationHandler,
  HyperlinkActivationResult,
  LinkPopoverContext,
  LinkPopoverResolution,
  LinkPopoverResolver,
  SurfaceHandle,
  SurfaceOutcome,
  SurfaceRequest,
} from '../core/types/index.js';
import type { BorrowedSuperDocUI } from '../public/ui/types.js';

type HyperlinkActivationResolution = HyperlinkActivationResult | LinkPopoverResolution;

type ApplicationHyperlinkResolution =
  | Extract<LinkPopoverResolution, { type: 'external' }>
  | Extract<HyperlinkActivationResult, { type: 'render' }>;

interface LinkNavigationHost {
  getHandles?: () => {
    editing?: {
      input?: { runAfterPendingInput?: (action: (signal?: AbortSignal) => Promise<boolean>) => Promise<boolean> };
    };
  };
}

interface TextSelectionPoint {
  kind: 'text';
  blockId: string;
  offset: number;
}

/**
 * A single-block text-selection target in the Document API `query.match`
 * result shape.
 */
interface TextSelectionTarget {
  kind: 'selection';
  start: TextSelectionPoint;
  end: TextSelectionPoint;
}

/** Block-anchored address carried by a hyperlink record. */
interface HyperlinkAddressShape {
  anchor?: { start?: { blockId?: string; offset?: number }; end?: { blockId?: string; offset?: number } };
}

/**
 * The subset of a Document API hyperlink record this composable reads. The
 * records come from the async `doc.hyperlinks` facade, so every field is
 * optional here.
 */
interface HyperlinkRecord {
  rId?: string;
  text?: string;
  externalTarget?: string;
  anchor?: string;
  targetKind?: string;
  hyperlinkNodeId?: string;
  address?: HyperlinkTarget | HyperlinkAddressShape;
}

/** A block record as read from `doc.blocks.list()`. */
interface BlockRecord {
  ordinal?: number;
  nodeId?: string;
}

/** Result of `doc.blocks.list()` as read here. */
interface BlocksListResult {
  blocks?: BlockRecord[];
}

/** One item of a `doc.query.match` result as read here. */
interface QueryMatchItem {
  target?: TextSelectionTarget;
}

/** Result of `doc.query.match` as read here. */
interface QueryMatchResult {
  items?: QueryMatchItem[];
}

/** One story entry of a `doc.hyperlinks.list()` result. */
interface HyperlinkStory {
  storyId?: string;
  partUri?: string;
  hyperlinks?: HyperlinkRecord[];
}

/** Result of `doc.hyperlinks.list()` as read here. */
interface HyperlinksListResult {
  stories?: HyperlinkStory[];
}

/** Result of `doc.hyperlinks.get()` as read here. */
interface HyperlinkGetResult {
  success?: boolean;
  hyperlink?: HyperlinkRecord;
}

/**
 * Result of `doc.bookmarks.get()` as read here (Document API `BookmarkInfo`).
 * `range.from.blockId` identifies the model paragraph sent to the viewport.
 * `address.story` is populated for non-body bookmarks (omitted for body),
 * which keeps anchor navigation scoped to body targets.
 */
interface BookmarkGetResult {
  address?: { story?: { kind?: string; storyType?: string } };
  range?: { from?: { blockId?: string; offset?: number } };
  tableColumn?: { colFirst: number; colLast: number };
}

type MaybePromise<T> = T | Promise<T>;

/**
 * The narrow Document API subset this composable reads. The facades and their
 * results are declared structurally here with every field optional; the call
 * sites keep their runtime narrowing (`Array.isArray`, `typeof`, `?.`) before
 * use. The async-capable facades may return promises, so their results are
 * awaited through `Promise.resolve(...)`.
 */
interface LinkPopoverDocumentApi {
  blocks?: { list?: () => BlocksListResult | null | undefined } | null;
  query?: {
    match?: (query: {
      select: { type: 'text'; pattern: string; caseSensitive: boolean };
      require: 'any';
    }) => QueryMatchResult | null | undefined;
  } | null;
  hyperlinks?: {
    list?: () => MaybePromise<HyperlinksListResult | null | undefined>;
    get?: (input: { storyId: string; hyperlinkNodeId: string }) => MaybePromise<HyperlinkGetResult | null | undefined>;
  } | null;
  bookmarks?: {
    list?: () => MaybePromise<{ items: Array<{ name: string }> }>;
    get?: (input: {
      target: { kind: 'entity'; entityType: 'bookmark'; name: string };
    }) => MaybePromise<BookmarkGetResult | null | undefined>;
  } | null;
}

/**
 * The `v2-link-click` payload the shell relays from the v2 host's
 * `onLinkClick` callback.
 */
interface LinkClickPayload {
  href: string;
  target: string | null;
  rel: string | null;
  tooltip: string | null;
  element: HTMLAnchorElement;
  clientX: number;
  clientY: number;
  documentMode: DocumentMode;
  editableText?: boolean;
}

/** Hyperlink identity resolved from the Document API for a clicked anchor. */
interface ResolvedHyperlinkTarget {
  storyId: string;
  hyperlinkNodeId: string | undefined;
  href: string;
  text: string | undefined;
  targetKind: string | undefined;
  address: HyperlinkTarget | undefined;
  textTarget: TextSelectionTarget | null;
}

interface PaintedSourceRef {
  partUri?: string;
  xpathLikePath?: string;
}

interface ActivePopover {
  href: string;
  element: HTMLAnchorElement;
  handle: SurfaceHandle;
  pointerDownTarget: EventTarget | null;
  unbindPointerDown: (() => void) | null;
}

interface AnchorNavigationOptions {
  placeCaret?: boolean;
  revalidateCaretAfterReveal?: boolean;
}

interface UseLinkPopoverOptions {
  getSurfaceManager: () => Pick<SurfaceManager, 'open'> | null | undefined;
  getActiveEditor: () => Editor | null | undefined;
  getUi: () => BorrowedSuperDocUI | null | undefined;
  getActivationHandler: () => HyperlinkActivationHandler | LinkPopoverResolver | null | undefined;
  getActivationHandlerSource?: () => 'hyperlinks.onActivate' | 'compatibility' | null | undefined;
  getBuiltInEditorDisabled?: () => boolean;
  shouldInterceptNavigationOnlyHyperlinks?: () => boolean;
  getLayerElement: () => HTMLElement | null | undefined;
  emitException: (payload: { error: Error; source: string }) => void;
}

const FLOATING_SURFACE_ID = 'link-popover';
const RECENT_OUTSIDE_CLOSE_MS = 500;
const MAX_ANCHOR_NAVIGATION_STEPS = 4;

const isThenable = (value: unknown): boolean =>
  Boolean(
    value &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function',
  );

function isLinkPopoverDocumentApi(value: unknown): value is LinkPopoverDocumentApi {
  return isPlainObject(value) || typeof value === 'function';
}

function linkPopoverDocumentApi(editor: Editor | null | undefined): LinkPopoverDocumentApi | null {
  const doc: unknown = editor?.doc;
  return isLinkPopoverDocumentApi(doc) ? doc : null;
}

function isLinkNavigationHost(value: unknown): value is LinkNavigationHost {
  return isPlainObject(value) || typeof value === 'function';
}

function markRawComponent(component: unknown): unknown {
  if ((typeof component === 'object' && component !== null) || typeof component === 'function') {
    return markRaw(component);
  }
  return component;
}

function isHyperlinkTarget(value: unknown): value is HyperlinkTarget {
  if (!isPlainObject(value) || value.kind !== 'inline' || value.nodeType !== 'hyperlink') return false;
  const anchor = isPlainObject(value.anchor) ? value.anchor : null;
  const start = anchor && isPlainObject(anchor.start) ? anchor.start : null;
  const end = anchor && isPlainObject(anchor.end) ? anchor.end : null;
  return (
    typeof start?.blockId === 'string' &&
    typeof start.offset === 'number' &&
    typeof end?.blockId === 'string' &&
    typeof end.offset === 'number'
  );
}

function isValidResolution(value: unknown): value is HyperlinkActivationResolution {
  if (!isPlainObject(value)) return false;
  if (value.type === 'default' || value.type === 'suppress' || value.type === 'none') return true;
  if (value.type === 'custom') return value.component != null;
  if (value.type === 'external') return typeof value.render === 'function';
  if (value.type === 'render') return typeof value.render === 'function';
  return false;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function linkOpenFeatures(rel: string | null | undefined): string {
  if (typeof rel !== 'string') return '';
  return rel
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token === 'noopener' || token === 'noreferrer')
    .filter((token, index, tokens) => tokens.indexOf(token) === index)
    .join(',');
}

function linkOpenFeaturesForTarget(rel: string | null | undefined, target: string): string {
  const features = linkOpenFeatures(rel);
  if (target !== '_blank') return features;
  const tokens = features ? features.split(',') : [];
  if (!tokens.includes('noopener')) tokens.unshift('noopener');
  return tokens.join(',');
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/['"\\]/g, '\\$&');
}

function decodeAnchorFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readPaintedSourceRef(element: HTMLElement | null | undefined): PaintedSourceRef | null {
  const encoded = element?.dataset?.sourceAnchor;
  if (!encoded) return null;
  try {
    const parsed: unknown = JSON.parse(encoded);
    const sourceRef = isPlainObject(parsed) ? parsed.sourceRef : undefined;
    if (!isPlainObject(sourceRef)) return null;
    const partUri = typeof sourceRef.partUri === 'string' ? sourceRef.partUri : undefined;
    const xpathLikePath = typeof sourceRef.xpathLikePath === 'string' ? sourceRef.xpathLikePath : undefined;
    return partUri || xpathLikePath ? { partUri, xpathLikePath } : null;
  } catch {
    return null;
  }
}

function readSourceParagraphOrdinal(fragment: HTMLElement | null | undefined): number | null {
  const path = readPaintedSourceRef(fragment)?.xpathLikePath;
  const match = path?.match(/w:p\[ordinal=(\d+)\]/);
  return match ? Number(match[1]) : null;
}

function readApiBlockId(
  fragment: HTMLElement | null | undefined,
  doc: LinkPopoverDocumentApi | null | undefined,
): string | undefined {
  const ordinal = readSourceParagraphOrdinal(fragment);
  const blocks = doc?.blocks?.list?.()?.blocks;
  const block = Array.isArray(blocks) ? blocks.find((candidate) => candidate.ordinal === ordinal) : null;
  return typeof block?.nodeId === 'string' ? block.nodeId : fragment?.dataset?.blockId;
}

function readClickedTextTarget(
  element: HTMLAnchorElement,
  doc: LinkPopoverDocumentApi | null | undefined,
): TextSelectionTarget | null {
  const fragment = element?.closest?.<HTMLElement>('[data-block-id][data-pm-start]');
  const blockId = readApiBlockId(fragment, doc);
  if (!blockId || !fragment || !element?.ownerDocument) return null;
  const pmStart = Number(element?.dataset?.pmStart);
  const pmEnd = Number(element?.dataset?.pmEnd);
  if (Number.isFinite(pmStart) && Number.isFinite(pmEnd) && pmEnd > pmStart) {
    const fragmentPmStart = Number(fragment?.dataset?.pmStart);
    const shouldConvertAbsolutePmOffset = Number.isFinite(fragmentPmStart) && pmStart >= fragmentPmStart;
    const start = shouldConvertAbsolutePmOffset ? pmStart - fragmentPmStart : pmStart;
    const end = shouldConvertAbsolutePmOffset ? pmEnd - fragmentPmStart : pmEnd;
    if (start < 0 || end <= start) return null;
    return {
      kind: 'selection',
      start: { kind: 'text', blockId, offset: start },
      end: { kind: 'text', blockId, offset: end },
    };
  }
  const ownerWindow = element.ownerDocument.defaultView;
  const nodeFilter = ownerWindow?.NodeFilter;
  const nodeCtor = ownerWindow?.Node;
  if (!nodeFilter || !nodeCtor) return null;

  let start = 0;
  const walker = element.ownerDocument.createTreeWalker(fragment, nodeFilter.SHOW_ELEMENT | nodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node === element) break;
    if (node.nodeType === nodeCtor.TEXT_NODE && !element.contains(node)) {
      start += node.textContent?.length ?? 0;
    }
    node = walker.nextNode();
  }
  if (node !== element) return null;
  const end = start + (element.textContent?.length ?? 0);
  if (end <= start) return null;
  return {
    kind: 'selection',
    start: { kind: 'text', blockId, offset: start },
    end: { kind: 'text', blockId, offset: end },
  };
}

function readClickedPartUri(element: HTMLAnchorElement): string | null {
  const sourceElement = element?.closest?.<HTMLElement>('[data-source-anchor]');
  return readPaintedSourceRef(sourceElement)?.partUri ?? null;
}

function normalizePartUri(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}

function normalizeHrefForMatch(value: string): string {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value, window.location.href).href;
  } catch {
    return value;
  }
}

function hrefFromHyperlink(hyperlink: HyperlinkRecord): string {
  if (typeof hyperlink?.externalTarget === 'string' && hyperlink.externalTarget) return hyperlink.externalTarget;
  if (typeof hyperlink?.anchor === 'string' && hyperlink.anchor) return `#${hyperlink.anchor}`;
  return '';
}

function textTargetFromHyperlinkAddress(
  address: HyperlinkAddressShape | HyperlinkTarget | null | undefined,
): TextSelectionTarget | null {
  const start = address?.anchor?.start;
  const end = address?.anchor?.end;
  if (typeof start?.blockId !== 'string' || typeof start?.offset !== 'number') return null;
  if (typeof end?.blockId !== 'string' || typeof end?.offset !== 'number') return null;
  if (start.blockId !== end.blockId) return null;
  return {
    kind: 'selection',
    start: { kind: 'text', blockId: start.blockId, offset: start.offset },
    end: { kind: 'text', blockId: end.blockId, offset: end.offset },
  };
}

function textTargetMatchesHyperlinkAddress(
  textTarget: TextSelectionTarget | null,
  address: HyperlinkAddressShape | HyperlinkTarget | null | undefined,
): boolean {
  const target = textTargetFromHyperlinkAddress(address);
  if (!target) return false;
  return (
    target.start.blockId === textTarget?.start?.blockId &&
    target.start.offset === textTarget?.start?.offset &&
    target.end.blockId === textTarget?.end?.blockId &&
    target.end.offset === textTarget?.end?.offset
  );
}

function textTargetFromQueryMatch(
  doc: LinkPopoverDocumentApi | null | undefined,
  text: string | undefined,
  blockId: string | undefined,
): TextSelectionTarget | null {
  if (typeof text !== 'string' || !text) return null;
  const result = doc?.query?.match?.({
    select: { type: 'text', pattern: text, caseSensitive: true },
    require: 'any',
  });
  // `QueryMatchItem` declares the target shape this function reads; the
  // runtime still narrows each item before trusting it.
  const targets = (Array.isArray(result?.items) ? result.items : [])
    .map((item) => item?.target)
    .filter(
      (target): target is TextSelectionTarget =>
        target?.kind === 'selection' && Boolean(target?.start?.blockId) && Boolean(target?.end?.blockId),
    );
  const blockTargets =
    typeof blockId === 'string'
      ? targets.filter((target) => target.start.blockId === blockId && target.end.blockId === blockId)
      : targets;
  if (blockTargets.length === 1) return blockTargets[0];
  if (typeof blockId === 'string') return null;
  return targets.length === 1 ? targets[0] : null;
}

/**
 * True when a clicked link element is inside a painted TOC entry
 * (`.superdoc-toc-entry`). TOC entry links navigate to their heading instead of
 * opening the link editor.
 */
function isTocEntryLinkElement(element: Element | null | undefined): boolean {
  return Boolean(element && typeof element.closest === 'function' && element.closest('.superdoc-toc-entry'));
}

function isNoteCrossReferenceLinkElement(element: Element | null | undefined): boolean {
  const kind = element?.getAttribute('data-sd-note-cross-reference');
  return (kind === 'ref' || kind === 'noteRef') && Boolean(element?.closest('[data-sd-note-role="body"]'));
}

export function useLinkPopover({
  getSurfaceManager,
  getActiveEditor,
  getUi,
  getActivationHandler,
  getActivationHandlerSource = () => null,
  getBuiltInEditorDisabled = () => false,
  shouldInterceptNavigationOnlyHyperlinks = () => false,
  getLayerElement,
  emitException,
}: UseLinkPopoverOptions) {
  let currentPopover: ActivePopover | null = null;
  let recentOutsideClose: { href: string; element: HTMLAnchorElement; closedAt: number } | null = null;
  let openGeneration = 0;
  const resolvedHyperlinksByActivation = new WeakMap<
    HyperlinkActivationContext,
    Promise<ResolvedHyperlinkTarget | null>
  >();

  function cancelPendingOpen() {
    openGeneration += 1;
  }

  function clearCurrentPopover(handle: SurfaceHandle | null | undefined, outcome?: SurfaceOutcome) {
    if (!handle || !currentPopover || currentPopover.handle !== handle) return;
    const activePopover = currentPopover;
    activePopover.unbindPointerDown?.();
    const NodeCtor = activePopover.element.ownerDocument?.defaultView?.Node;
    const closedFromSameLinkPointer =
      NodeCtor != null &&
      activePopover.pointerDownTarget instanceof NodeCtor &&
      activePopover.element.contains(activePopover.pointerDownTarget);
    if (outcome?.status === 'closed' && outcome.reason === undefined && closedFromSameLinkPointer) {
      recentOutsideClose = {
        href: activePopover.href,
        element: activePopover.element,
        closedAt: Date.now(),
      };
    }
    currentPopover = null;
  }

  function closeCurrentPopover(reason = 'closed') {
    cancelPendingOpen();
    const activePopover = currentPopover;
    currentPopover = null;
    recentOutsideClose = null;
    activePopover?.unbindPointerDown?.();
    activePopover?.handle?.close?.(reason);
  }

  function sharedFloatingConfig(ctx: HyperlinkActivationContext): DirectSurfaceRequest {
    return {
      id: FLOATING_SURFACE_ID,
      mode: 'floating',
      closeOnEscape: true,
      floating: {
        top: ctx.position.top,
        left: ctx.position.left,
        autoFocus: true,
        closeOnOutsidePointerDown: true,
        width: 'auto',
      },
    };
  }

  function rememberHandle(ctx: HyperlinkActivationContext, handle: SurfaceHandle) {
    const activePopover: ActivePopover = {
      href: ctx.href,
      element: ctx.element,
      handle,
      pointerDownTarget: null,
      unbindPointerDown: null,
    };
    const ownerDocument = ctx.element.ownerDocument;
    const onPointerDown = (event: PointerEvent) => {
      activePopover.pointerDownTarget = event.target ?? null;
    };
    ownerDocument.addEventListener('pointerdown', onPointerDown, true);
    activePopover.unbindPointerDown = () => ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
    currentPopover = activePopover;
    recentOutsideClose = null;
    handle.result?.then?.(
      (outcome) => clearCurrentPopover(handle, outcome),
      () => clearCurrentPopover(handle),
    );
  }

  /**
   * Find a mounted named anchor for runtimes that do not expose the bookmark
   * model. Model-backed runtimes never use DOM identity for navigation.
   */
  function findMountedAnchor(container: HTMLElement | null, escapedAnchorName: string): HTMLElement | null {
    return (
      container?.querySelector?.<HTMLElement>(
        `a[name='${escapedAnchorName}'], [data-bookmark-marker='start'][data-bookmark-name='${escapedAnchorName}']`,
      ) ?? null
    );
  }

  /**
   * Move the editable caret to the start of a resolved target paragraph after
   * navigating to it. Mirrors V1's `goToAnchor`, whose final step places the
   * caret at the bookmark position: without it a V2 TOC click only scrolls, so
   * the caret stays wherever it last was (typically inside the TOC field) and
   * subsequent typing corrupts the TOC instead of editing the heading.
   *
   * Best-effort and body-story only. The authoring facade self-guards in
   * viewing mode (no editable selection target), so callers gate this to
   * editing/suggesting via `placeCaret`.
   */
  async function placeCaretAtBookmark(blockId: string, offset: number) {
    const setSelectionTarget = getActiveEditor()?.authoring?.setSelectionTarget;
    if (typeof setSelectionTarget !== 'function') return;

    const story = { kind: 'story', storyType: 'body' };
    const anchor = { kind: 'text', blockId, offset, story };
    const target = { kind: 'selection', start: anchor, end: anchor, story };
    try {
      await Promise.resolve(setSelectionTarget({ target, collapse: 'start', focus: true }));
    } catch {
      // Caret placement is best-effort; navigation may still continue.
    }
  }

  /**
   * Navigate to a body bookmark through its model address. A mounted-anchor
   * fallback is reserved for runtimes without a callable bookmark model.
   */
  async function navigateToAnchor(
    anchorUrl: string | null | undefined,
    { placeCaret = false, revalidateCaretAfterReveal = false }: AnchorNavigationOptions = {},
  ): Promise<boolean> {
    if (typeof anchorUrl !== 'string' || !anchorUrl.startsWith('#')) return false;
    const anchorName = decodeAnchorFragment(anchorUrl.slice(1));
    const editor = getActiveEditor();
    const generation = openGeneration;
    const navigate = (signal?: AbortSignal) =>
      navigateAnchorInEditor(anchorName, editor, generation, placeCaret, revalidateCaretAfterReveal, signal);
    if (revalidateCaretAfterReveal) {
      try {
        const host = editor?.host;
        const input = isLinkNavigationHost(host) ? host.getHandles?.()?.editing?.input : undefined;
        if (typeof input?.runAfterPendingInput === 'function') return await input.runAfterPendingInput(navigate);
      } catch {
        return false;
      }
    }
    return navigate();
  }

  async function navigateAnchorInEditor(
    anchorName: string,
    editor: Editor | null | undefined,
    generation: number,
    placeCaret: boolean,
    revalidateCaretAfterReveal: boolean,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted || editor !== getActiveEditor() || generation !== openGeneration) return false;
    const doc = linkPopoverDocumentApi(editor);
    const bookmarkGet = doc?.bookmarks?.get;
    if (typeof bookmarkGet !== 'function') {
      const mountedAnchor = findMountedAnchor(getUi()?.viewport?.getHost?.() ?? null, cssEscape(anchorName));
      if (!mountedAnchor) return false;
      scrollToElement(mountedAnchor, { block: 'start', behavior: 'instant' });
      return true;
    }
    const readBodyBookmark = async () => {
      try {
        const list = doc?.bookmarks?.list;
        if (typeof list === 'function') {
          const catalog = await Promise.resolve(list.call(doc?.bookmarks));
          if (signal?.aborted || editor !== getActiveEditor() || generation !== openGeneration) return null;
          if (catalog?.items?.filter((item) => item.name === anchorName).length !== 1) return null;
        }
        const bookmark = await Promise.resolve(
          bookmarkGet.call(doc?.bookmarks, {
            target: { kind: 'entity', entityType: 'bookmark', name: anchorName },
          }),
        );
        if (signal?.aborted || editor !== getActiveEditor() || generation !== openGeneration) return null;
        const story = bookmark?.address?.story;
        if ((story && story.storyType !== 'body') || bookmark?.tableColumn) return null;
        const blockId = bookmark?.range?.from?.blockId;
        const offset = bookmark?.range?.from?.offset ?? 0;
        if (typeof blockId !== 'string' || !Number.isInteger(offset) || offset < 0) return null;
        return { blockId, offset };
      } catch {
        return null;
      }
    };
    let position = await readBodyBookmark();
    if (!position || signal?.aborted || editor !== getActiveEditor() || generation !== openGeneration) return false;
    if (placeCaret && !revalidateCaretAfterReveal) await placeCaretAtBookmark(position.blockId, position.offset);
    const viewport = getUi()?.viewport;
    const scrollIntoView = viewport?.scrollIntoView;
    if (typeof scrollIntoView !== 'function') return false;
    for (let step = 0; step < MAX_ANCHOR_NAVIGATION_STEPS; step += 1) {
      if (signal?.aborted || editor !== getActiveEditor() || generation !== openGeneration) return false;
      try {
        const target: TextAddress = {
          kind: 'text',
          blockId: position.blockId,
          range: { start: position.offset, end: position.offset },
        };
        const result = await Promise.resolve(
          scrollIntoView.call(viewport, { target, block: 'start', behavior: 'instant' }),
        );
        if (signal?.aborted || editor !== getActiveEditor() || generation !== openGeneration) return false;
        if (result?.success !== false) {
          if (revalidateCaretAfterReveal) {
            const current = await readBodyBookmark();
            if (!current || signal?.aborted || editor !== getActiveEditor() || generation !== openGeneration)
              return false;
            if (current.blockId !== position.blockId || current.offset !== position.offset) {
              position = current;
              continue;
            }
            if (placeCaret) await placeCaretAtBookmark(current.blockId, current.offset);
            if (signal?.aborted || editor !== getActiveEditor() || generation !== openGeneration) return false;
          }
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  }

  async function resolveClickedHyperlink(ctx: HyperlinkActivationContext): Promise<ResolvedHyperlinkTarget | null> {
    const doc = linkPopoverDocumentApi(ctx.editor);
    let result;
    try {
      result = await Promise.resolve(doc?.hyperlinks?.list?.());
    } catch {
      return null;
    }
    const stories = Array.isArray(result?.stories) ? result.stories : [];
    const clickedRid = ctx.element?.dataset?.linkRid;
    const clickedText = ctx.element?.textContent ?? '';
    const clickedHref = normalizeHrefForMatch(ctx.href);
    const clickedTextTarget = readClickedTextTarget(ctx.element, doc);
    const clickedPartUri = readClickedPartUri(ctx.element);
    const storiesWithPartUris = stories.filter(
      (story): story is HyperlinkStory & { partUri: string } => typeof story?.partUri === 'string',
    );
    const candidateStories =
      clickedPartUri && storiesWithPartUris.length > 0
        ? storiesWithPartUris.filter((story) => normalizePartUri(story.partUri) === normalizePartUri(clickedPartUri))
        : stories;

    for (const story of candidateStories) {
      // `HyperlinkStory` declares the record shape this loop reads; the
      // runtime still narrows the array before trusting it.
      const hyperlinks = Array.isArray(story?.hyperlinks) ? story.hyperlinks : [];
      const hydrateHyperlink = async (hyperlink: HyperlinkRecord): Promise<HyperlinkRecord> => {
        if (!hyperlink?.hyperlinkNodeId || !story?.storyId || hyperlink.address) return hyperlink;
        try {
          const detailedResult = await Promise.resolve(
            doc?.hyperlinks?.get?.({
              storyId: story.storyId,
              hyperlinkNodeId: hyperlink.hyperlinkNodeId,
            }),
          );
          return detailedResult?.success && detailedResult.hyperlink ? detailedResult.hyperlink : hyperlink;
        } catch {
          return hyperlink;
        }
      };
      const addressHit = async (matches: HyperlinkRecord[]) => {
        if (!clickedTextTarget) return null;
        const hydratedMatches = await Promise.all(matches.map(hydrateHyperlink));
        const addressMatches = hydratedMatches.filter((hyperlink) =>
          textTargetMatchesHyperlinkAddress(clickedTextTarget, hyperlink.address),
        );
        return addressMatches.length === 1 ? addressMatches[0] : null;
      };
      const ridMatches = clickedRid ? hyperlinks.filter((hyperlink) => hyperlink.rId === clickedRid) : [];
      const exactRidMatches = ridMatches.filter((hyperlink) => hyperlink.text === clickedText);
      const exactTargetMatches = hyperlinks.filter((hyperlink) => {
        const target = normalizeHrefForMatch(hrefFromHyperlink(hyperlink));
        return target === clickedHref && hyperlink.text === clickedText;
      });
      const textMatches = hyperlinks.filter((hyperlink) => hyperlink.text === clickedText);
      const segmentMatches = hyperlinks.filter((hyperlink) => {
        const target = normalizeHrefForMatch(hrefFromHyperlink(hyperlink));
        return clickedText && target === clickedHref && hyperlink.text?.includes?.(clickedText);
      });
      const exactRidHit = exactRidMatches.length === 1 ? exactRidMatches[0] : null;
      const exactTargetHit = exactTargetMatches.length === 1 ? exactTargetMatches[0] : null;
      const textHit = textMatches.length === 1 ? textMatches[0] : null;
      const segmentHit = segmentMatches.length === 1 ? segmentMatches[0] : null;
      const ridHit = ridMatches.length === 1 ? ridMatches[0] : null;
      const resolvedHit =
        exactRidHit ??
        (await addressHit(exactRidMatches)) ??
        exactTargetHit ??
        (await addressHit(exactTargetMatches)) ??
        textHit ??
        (await addressHit(textMatches)) ??
        segmentHit ??
        (await addressHit(segmentMatches)) ??
        ridHit ??
        (await addressHit(ridMatches));
      if (resolvedHit?.hyperlinkNodeId && story?.storyId) {
        const detailedHit = await hydrateHyperlink(resolvedHit);
        const addressTarget = textTargetFromHyperlinkAddress(detailedHit.address);
        return {
          storyId: story.storyId,
          hyperlinkNodeId: detailedHit.hyperlinkNodeId,
          href: hrefFromHyperlink(detailedHit),
          text: detailedHit.text,
          targetKind: detailedHit.targetKind,
          address: isHyperlinkTarget(detailedHit.address) ? detailedHit.address : undefined,
          textTarget:
            addressTarget ?? textTargetFromQueryMatch(doc, detailedHit.text, clickedTextTarget?.start?.blockId),
        };
      }
    }
    return null;
  }

  /**
   * Resolve a clicked hyperlink once per activation. The handler and built-in
   * UI can both request the same Document API target.
   */
  function resolveClickedHyperlinkOnce(ctx: HyperlinkActivationContext): Promise<ResolvedHyperlinkTarget | null> {
    const pending = resolvedHyperlinksByActivation.get(ctx);
    if (pending) return pending;
    const resolution = resolveClickedHyperlink(ctx);
    resolvedHyperlinksByActivation.set(ctx, resolution);
    return resolution;
  }

  function matchesRecentOutsideClose(payload: LinkClickPayload): boolean {
    if (!recentOutsideClose) return false;
    const isSameLink = recentOutsideClose.element === payload.element && recentOutsideClose.href === payload.href;
    const isRecent = Date.now() - recentOutsideClose.closedAt <= RECENT_OUTSIDE_CLOSE_MS;
    if (!isSameLink || !isRecent) return false;
    recentOutsideClose = null;
    return true;
  }

  function openSurfaceDeferred(ctx: HyperlinkActivationContext, request: SurfaceRequest) {
    const manager = getSurfaceManager();
    if (!manager?.open) return;
    const generation = openGeneration;
    queueMicrotask(() => {
      if (generation !== openGeneration) return;
      const handle = manager.open(request);
      rememberHandle(ctx, handle);
    });
  }

  function openDefaultPopover(ctx: HyperlinkActivationContext) {
    closeCurrentPopover('replace');

    // The V2 host arbitrates TOC editing gestures before link activation;
    // deliberate activation navigates rather than opening the hyperlink editor.
    if (ctx.isAnchorLink && isTocEntryLinkElement(ctx.element)) {
      void navigateToAnchor(ctx.href, { placeCaret: ctx.documentMode !== 'viewing' });
      return;
    }

    if (ctx.defaultAction === 'navigate') {
      if (ctx.isAnchorLink) {
        const noteReference = isNoteCrossReferenceLinkElement(ctx.element);
        void navigateToAnchor(ctx.href, {
          placeCaret: noteReference && ctx.documentMode !== 'viewing',
          revalidateCaretAfterReveal: noteReference && ctx.documentMode !== 'viewing',
        });
      } else if (ctx.href) {
        const target = ctx.target || '_self';
        const features = linkOpenFeaturesForTarget(ctx.rel, target);
        if (features) {
          window.open(ctx.href, target, features);
        } else {
          window.open(ctx.href, target);
        }
      }
      return;
    }

    if (getBuiltInEditorDisabled()) return;

    const closePopover = () => closeCurrentPopover('closed');
    const goToAnchor = async (anchorUrl: string | null | undefined) => {
      const success = await navigateToAnchor(anchorUrl, { placeCaret: ctx.documentMode !== 'viewing' });
      if (success) closePopover();
      return success;
    };
    const generation = openGeneration;
    const openWithHyperlinkTarget = (hyperlinkTarget: ResolvedHyperlinkTarget | null) => {
      if (generation !== openGeneration) return;
      openSurfaceDeferred(ctx, {
        ...sharedFloatingConfig(ctx),
        component: markRawComponent(LinkInput),
        props: {
          href: hyperlinkTarget?.href || ctx.href,
          target: ctx.target,
          rel: ctx.rel,
          tooltip: ctx.tooltip,
          clickedElement: ctx.element,
          hyperlinkTarget,
          hyperlinkText: hyperlinkTarget?.text,
          textTarget:
            hyperlinkTarget?.textTarget ?? readClickedTextTarget(ctx.element, linkPopoverDocumentApi(ctx.editor)),
          documentMode: ctx.documentMode,
          ui: getUi(),
          closePopover,
          goToAnchor,
        },
      });
    };
    resolveClickedHyperlinkOnce(ctx).then(openWithHyperlinkTarget, () => openWithHyperlinkTarget(null));
  }

  function openCustomPopover(
    ctx: HyperlinkActivationContext,
    resolution: Extract<LinkPopoverResolution, { type: 'custom' }>,
  ) {
    closeCurrentPopover('replace');
    const closePopover = () => closeCurrentPopover('closed');
    openSurfaceDeferred(ctx, {
      ...sharedFloatingConfig(ctx),
      component: markRawComponent(resolution.component),
      props: {
        ...resolution.props,
        editor: ctx.editor,
        href: ctx.href,
        closePopover,
      },
    });
  }

  function openApplicationHyperlinkUi(ctx: HyperlinkActivationContext, resolution: ApplicationHyperlinkResolution) {
    closeCurrentPopover('replace');
    const renderHyperlinkUi = resolution.type === 'render' ? resolution.render : null;
    const renderExternalPopover = resolution.type === 'external' ? resolution.render : null;
    openSurfaceDeferred(ctx, {
      ...sharedFloatingConfig(ctx),
      render: (surfaceCtx: ExternalSurfaceRenderContext) => {
        try {
          const shared = { container: surfaceCtx.container, editor: ctx.editor, href: ctx.href };
          return renderHyperlinkUi
            ? renderHyperlinkUi({ ...shared, close: () => surfaceCtx.close('closed') })
            : renderExternalPopover?.({ ...shared, closePopover: () => surfaceCtx.close('closed') });
        } catch (error) {
          const usesOnActivate = resolution.type === 'render';
          emitException({
            error: toError(error),
            source: usesOnActivate ? 'hyperlinks.onActivate.render' : 'linkPopoverExternalRender',
          });
          surfaceCtx.close('external-error');
          if (!usesOnActivate) {
            const generation = openGeneration;
            queueMicrotask(() => {
              if (generation === openGeneration) openDefaultPopover(ctx);
            });
          }
          return undefined;
        }
      },
    });
  }
  function buildContext(payload: LinkClickPayload): LinkPopoverContext {
    const layerRect = getLayerElement()?.getBoundingClientRect?.();
    const layerLeft = typeof layerRect?.left === 'number' ? layerRect.left : 0;
    const layerTop = typeof layerRect?.top === 'number' ? layerRect.top : 0;
    const context: LinkPopoverContext = {
      // A link click always originates from a mounted editor surface, so the
      // active editor is present here; the public context type declares it
      // required.
      // A link click always originates from a mounted editor surface, so the
      // active editor is present here; the public context type declares it
      // required.
      editor: getActiveEditor()!,
      href: payload.href,
      target: payload.target,
      rel: payload.rel,
      tooltip: payload.tooltip,
      element: payload.element,
      clientX: payload.clientX,
      clientY: payload.clientY,
      isAnchorLink: payload.href.startsWith('#'),
      documentMode: payload.documentMode,
      defaultAction:
        payload.documentMode === 'viewing' ||
        payload.editableText === false ||
        (payload.href.startsWith('#') && isTocEntryLinkElement(payload.element))
          ? 'navigate'
          : 'edit',
      position: {
        left: `${Math.max(0, payload.clientX - layerLeft)}px`,
        top: `${Math.max(0, payload.clientY - layerTop)}px`,
      },
      getDocumentTarget: async () => (await resolveClickedHyperlinkOnce(context))?.address ?? null,
      closePopover: () => closeCurrentPopover('closed'),
    };
    return context;
  }

  function resolveActivation(ctx: LinkPopoverContext): HyperlinkActivationResolution {
    const handler = getActivationHandler();
    if (typeof handler !== 'function') return { type: 'default' };
    const usesOnActivate = getActivationHandlerSource() === 'hyperlinks.onActivate';
    const errorSource = usesOnActivate ? 'hyperlinks.onActivate' : 'linkPopoverResolver';
    const fallbackResolution = (): HyperlinkActivationResolution =>
      usesOnActivate ? { type: 'suppress' } : { type: 'default' };

    try {
      const resolution = handler(ctx);
      if (isThenable(resolution)) {
        void Promise.resolve(resolution).catch(() => undefined);
        emitException({
          error: new Error(
            usesOnActivate
              ? 'hyperlinks.onActivate must return synchronously; Promises are not supported.'
              : 'The hyperlink activation handler must return synchronously.',
          ),
          source: errorSource,
        });
        return fallbackResolution();
      }
      if (resolution == null) return { type: 'default' };
      if (!isValidResolution(resolution)) {
        emitException({
          error: new Error(
            usesOnActivate
              ? 'hyperlinks.onActivate returned an invalid result.'
              : 'The hyperlink activation handler returned an invalid result.',
          ),
          source: errorSource,
        });
        return fallbackResolution();
      }
      return resolution;
    } catch (error) {
      emitException({ error: toError(error), source: errorSource });
      return fallbackResolution();
    }
  }

  function handleLinkClick(payload: LinkClickPayload | null | undefined) {
    if (!payload?.element || typeof payload.href !== 'string') return;
    cancelPendingOpen();
    if (currentPopover && currentPopover.element === payload.element && currentPopover.href === payload.href) {
      closeCurrentPopover('toggle');
      return;
    }
    if (matchesRecentOutsideClose(payload)) return;

    const ctx = buildContext(payload);
    if (payload.editableText === false && !shouldInterceptNavigationOnlyHyperlinks()) {
      openDefaultPopover(ctx);
      return;
    }
    const resolution = resolveActivation(ctx);

    if (resolution.type === 'suppress' || resolution.type === 'none') {
      closeCurrentPopover('none');
      return;
    }
    if (resolution.type === 'custom') {
      openCustomPopover(ctx, resolution);
      return;
    }
    if (resolution.type === 'external' || resolution.type === 'render') {
      openApplicationHyperlinkUi(ctx, resolution);
      return;
    }
    openDefaultPopover(ctx);
  }

  function destroy() {
    closeCurrentPopover('destroyed');
  }

  return {
    handleLinkClick,
    closeCurrentPopover,
    destroy,
  };
}
