import { isPlainObject } from '../../helpers/object-guards.js';
import { isFiniteNumber } from '../../helpers/is-finite-number.js';
import { hostMethod, safeCall } from './command-results.js';
import { collectEntityHitsFromChain } from './entity-at.js';
import { entityRowMatchesRequest, layoutStoryDatasetToStoryLocator, storyKeyToStoryLocator } from './entity-rows.js';
import type { LooseRecord } from './loose-record.js';
import {
  buildStoryScopedTrackedChangeIdContext,
  buildTrackedChangeIdContext,
  isTextboxStory,
} from './tracked-change-ids.js';
import type {
  SelectionSlice,
  SelectionTarget,
  TrackChangesItem,
  ViewportContext,
  ViewportEntityAddress,
  ViewportEntityHit,
  ViewportPositionAtInput,
  ViewportPositionAtResult,
} from './types.js';

export interface ViewportPointQueriesDeps {
  superdoc: LooseRecord;
  getEditor: () => LooseRecord | null;
  isDisposed: () => boolean;
  contentToken: () => string;
  computeSelection: () => SelectionSlice;
  readPublicTrackChangeItems: () => readonly TrackChangesItem[];
  readAllStoryTrackChanges: () => readonly TrackChangesItem[] | null;
  decorationOwnerForProvider: (providerId: string) => { id: string; data?: unknown } | null;
}

export interface PointHitElements {
  container: HTMLElement;
  elements: Element[];
  x: number;
  y: number;
}

export interface EntityAt {
  (x: number, y: number): ViewportEntityAddress | null;
  (input: { x: number; y: number }): readonly ViewportEntityHit[];
}

export interface ViewportPointQueries {
  resolveVisibleHost: () => HTMLElement | null;
  pointHitElements: (x: unknown, y: unknown) => PointHitElements | null;
  entityAt: EntityAt;
  positionAt: (input: ViewportPositionAtInput) => Promise<ViewportPositionAtResult>;
  contextAt: (input: { x: number; y: number }) => ViewportContext;
}

function readMember(owner: unknown, key: string): unknown {
  return owner === null || owner === undefined ? undefined : Reflect.get(Object(owner), key, owner);
}

function copyPoint(input: { x: number; y: number }): { x: number; y: number } {
  return { x: input.x, y: input.y };
}

const TRACK_CHANGE_MARKER_SELECTOR = '[data-track-change-marker]';
const NUMBER_FORM_HAS_NO_RESOLVABLE_ENTITY_ADDRESS = null;

export function createViewportPointQueries(deps: ViewportPointQueriesDeps): ViewportPointQueries {
  const { superdoc, getEditor } = deps;

  const resolveVisibleHost = (): HTMLElement | null => {
    if (typeof HTMLElement === 'undefined') return null;
    const mountContainer = readMember(getEditor()?.mount, 'container');
    if (mountContainer instanceof HTMLElement) return mountContainer;
    const root = superdoc?.element;
    if (root instanceof HTMLElement) return root;
    return null;
  };

  const stackedElementsAt = (dom: Document, x: number, y: number): Element[] => {
    const elementsFromPoint = dom.elementsFromPoint;
    if (typeof elementsFromPoint !== 'function') return [];
    try {
      return elementsFromPoint.call(dom, x, y) ?? [];
    } catch {
      return [];
    }
  };

  const pointHitElements = (x: unknown, y: unknown): PointHitElements | null => {
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    const dom: Document | undefined = globalThis.document;
    if (!dom || typeof dom.elementFromPoint !== 'function') return null;
    const container = resolveVisibleHost();
    if (!container) return null;
    const startEl = dom.elementFromPoint(x, y);
    if (!startEl || !container.contains(startEl)) return null;

    const hostScopedElements: Element[] = [startEl];
    for (const el of stackedElementsAt(dom, x, y)) {
      if (el && container.contains(el) && !hostScopedElements.includes(el)) hostScopedElements.push(el);
    }
    return { container, elements: hostScopedElements, x, y };
  };

  const elementBoxContainsPoint = (el: Element, point: PointHitElements): boolean => {
    const getRect = el.getBoundingClientRect;
    if (typeof getRect !== 'function') return false;
    let rect: DOMRect;
    try {
      rect = getRect.call(el);
    } catch {
      return false;
    }
    return (
      rect != null && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
    );
  };

  const pointerInertMarkersDeepestFirst = (point: PointHitElements): Element[] => {
    const { container, elements: primaryEls } = point;
    const markerEls: Element[] = [];
    const addMarkerEl = (el: Element | null | undefined): void => {
      if (el && container.contains(el) && !markerEls.includes(el) && !primaryEls.includes(el)) markerEls.push(el);
    };
    for (const el of primaryEls) {
      const queryAll = el.querySelectorAll;
      if (typeof queryAll !== 'function') continue;
      let markers: ArrayLike<Element>;
      try {
        markers = queryAll.call(el, TRACK_CHANGE_MARKER_SELECTOR);
      } catch {
        continue;
      }
      for (let i = 0; i < markers.length; i += 1) {
        if (elementBoxContainsPoint(markers[i], point)) addMarkerEl(markers[i]);
      }
    }
    return markerEls.reverse();
  };

  const pointEntityHits = (x: unknown, y: unknown): readonly ViewportEntityHit[] => {
    const point = pointHitElements(x, y);
    if (!point) return [];
    const { container } = point;
    const startEls: Element[] = [...pointerInertMarkersDeepestFirst(point), ...point.elements];

    const rawHits = collectEntityHitsFromChain(startEls[0], container);
    for (let i = 1; i < startEls.length; i += 1) {
      for (const hit of collectEntityHitsFromChain(startEls[i], container)) rawHits.push(hit);
    }
    if (rawHits.length === 0) return rawHits;

    const publicFeedIdContext = buildTrackedChangeIdContext(deps.readPublicTrackChangeItems());
    let allStoryItemsReadOnFirstStoryHit: readonly TrackChangesItem[] | null | undefined;
    const seen = new Set<string>();
    const hits: ViewportEntityHit[] = [];
    for (const hit of rawHits) {
      if (hit.type === 'decoration') {
        const owner = deps.decorationOwnerForProvider(hit.id);
        if (!owner) continue;
        const key = `decoration:${owner.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ type: 'decoration', id: owner.id });
        continue;
      }
      if (hit.type !== 'trackedChange') {
        const layoutStory = hit.type === 'contentControl' ? layoutStoryDatasetToStoryLocator(hit.story) : undefined;
        const story =
          hit.type === 'contentControl'
            ? isTextboxStory(layoutStory)
              ? layoutStory
              : (storyKeyToStoryLocator(hit.storyKey) ?? layoutStory)
            : undefined;
        const key = `${hit.type}:${hit.id}:${JSON.stringify(story ?? null)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (hit.type === 'contentControl') {
          const { storyKey: _storyKey, story: _paintedStory, ...publicHit } = hit;
          hits.push(story ? { ...publicHit, story } : publicHit);
        } else {
          hits.push(hit);
        }
        continue;
      }
      const story = storyKeyToStoryLocator(hit.storyKey) ?? layoutStoryDatasetToStoryLocator(hit.story);
      let publicId: string | null;
      if (story) {
        if (allStoryItemsReadOnFirstStoryHit === undefined) {
          allStoryItemsReadOnFirstStoryHit = deps.readAllStoryTrackChanges();
        }
        const allStoryItems = allStoryItemsReadOnFirstStoryHit;
        if (!allStoryItems) continue;
        const storyScopedId = buildStoryScopedTrackedChangeIdContext(allStoryItems, story).toPublicId(hit.id);
        if (!storyScopedId || !allStoryItems.some((item) => entityRowMatchesRequest(item, storyScopedId, story))) {
          continue;
        }
        publicId = storyScopedId;
      } else {
        publicId = publicFeedIdContext.toPublicId(hit.id);
        if (!publicId) continue;
      }
      const key = `trackedChange:${publicId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(story ? { type: 'trackedChange', id: publicId, story } : { type: 'trackedChange', id: publicId });
    }
    return hits;
  };

  function entityAt(x: number, y: number): ViewportEntityAddress | null;
  function entityAt(input: { x: number; y: number }): readonly ViewportEntityHit[];
  function entityAt(
    xOrInput: number | { x: number; y: number },
    _y?: number,
  ): ViewportEntityAddress | readonly ViewportEntityHit[] | null {
    if (typeof xOrInput === 'object') return pointEntityHits(xOrInput?.x, xOrInput?.y);
    return NUMBER_FORM_HAS_NO_RESOLVABLE_ENTITY_ADDRESS;
  }

  const pointInVisibleHost = (x: number, y: number): boolean => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const host = resolveVisibleHost();
    if (!host) return false;
    const rect = host.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  const isPointSelectionTarget = (value: unknown): value is SelectionTarget => {
    if (!isPlainObject(value) || value.kind !== 'selection') return false;
    return [value.start, value.end].every(
      (point) =>
        isPlainObject(point) &&
        point.kind === 'text' &&
        typeof point.blockId === 'string' &&
        typeof point.offset === 'number' &&
        Number.isSafeInteger(point.offset) &&
        point.offset >= 0,
    );
  };

  async function positionAt(input: ViewportPositionAtInput): Promise<ViewportPositionAtResult> {
    if (deps.isDisposed()) return { status: 'disposed' };
    if (input?.signal?.aborted) return { status: 'cancelled' };
    if (!input || typeof input.x !== 'number' || typeof input.y !== 'number' || !pointInVisibleHost(input.x, input.y))
      return { status: 'no-target' };
    const editor = getEditor(),
      viewportQuery = editor?.viewportQuery,
      token = deps.contentToken();
    const getTargetAtPoint = hostMethod(viewportQuery, 'getTargetAtPoint');
    if (!getTargetAtPoint) return { status: 'unavailable' };
    const result = await getTargetAtPoint({ clientX: input.x, clientY: input.y });
    if (deps.isDisposed()) return { status: 'disposed' };
    if (input.signal?.aborted) return { status: 'cancelled' };
    if (editor !== getEditor() || viewportQuery !== getEditor()?.viewportQuery || token !== deps.contentToken())
      return { status: 'stale' };
    if (!isPlainObject(result)) throw new Error('Viewport point query returned an invalid host result');
    if (result.status === 'resolved') {
      if (!isPointSelectionTarget(result.target)) throw new Error('Viewport point query returned an invalid target');
      return { status: 'resolved', target: result.target };
    }
    if (result.status === 'no-target' || result.status === 'stale' || result.status === 'disposed')
      return { status: result.status };
    throw new Error('Viewport point query returned an invalid host result');
  }

  function contextAt(input: { x: number; y: number }): ViewportContext {
    const validInput = !!input && typeof input.x === 'number' && typeof input.y === 'number';
    const point = validInput ? copyPoint(input) : { x: 0, y: 0 };

    return {
      point,
      entities: validInput ? entityAt(point) : [],
      selection: (() => {
        const current = deps.computeSelection();
        return current.status === 'ready' ? current : { ...current, tableSelection: null };
      })(),
      position: null,
      insideSelection:
        validInput && pointInVisibleHost(point.x, point.y)
          ? safeCall(
              () =>
                hostMethod(
                  getEditor()?.viewportQuery,
                  'isPointInPaintedSelection',
                )?.({
                  clientX: point.x,
                  clientY: point.y,
                }) === true,
              false,
            )
          : false,
    };
  }

  return { resolveVisibleHost, pointHitElements, entityAt, positionAt, contextAt };
}
