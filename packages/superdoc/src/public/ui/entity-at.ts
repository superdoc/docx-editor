/**
 * Walk a painted-DOM element chain (innermost → outermost) and collect entity
 * hits for `ui.viewport.entityAt`.
 *
 * Pure function — takes a starting element, returns the hits. The
 * `document.elementFromPoint` lookup that produces the starting element lives
 * in the controller; this helper is what makes the data-attribute walk testable
 * without stubbing globals. The painter's `data-*` attribute names stay an
 * implementation detail of the painter and this module: consumers never read
 * them, they switch on the typed `ViewportEntityHit[]` this produces.
 */

import type { ViewportEntityHit } from './types.js';

/**
 * A collected hit, optionally carrying the raw painter `data-story-key` string
 * read off the run/marker element. `storyKey` is an internal carrier the
 * controller PREFERS over the layout-story when mapping a tracked change to a
 * public {@link StoryLocator}; it is never surfaced on a returned public hit
 * (the controller resolves a locator from it, then builds the public hit
 * fresh). Kept off the public {@link ViewportEntityHit} so consumers still only
 * switch on the typed public shape.
 */
export interface CollectedEntityHit extends ViewportEntityHit {
  storyKey?: string;
}

function parseCommaSeparatedIds(value: string): string[] {
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Collect every public-id candidate a painted run can carry for a tracked
 * change, deduped, in priority order: the canonical
 * `data-track-change-preferred-target-id` first (when the painter stamps one),
 * then the `data-track-change-ids` list, then the singular
 * `data-track-change-id`. The caller validates these against the live
 * tracked-changes slice and keeps whichever is the public id, so it does not
 * matter which attribute carries it — an imported/raw alias on one attribute
 * never hides the public id on another (a union, not a prefer-one-attribute).
 */
function getTrackChangeIds(node: { getAttribute(name: string): string | null }): string[] {
  const out: string[] = [];
  const add = (id: string | null): void => {
    if (id && !out.includes(id)) out.push(id);
  };
  add(node.getAttribute('data-track-change-preferred-target-id'));
  const list = node.getAttribute('data-track-change-ids');
  if (list) for (const id of parseCommaSeparatedIds(list)) add(id);
  add(node.getAttribute('data-track-change-id'));
  return out;
}

/**
 * Read painted entities off `el` and every ancestor up to the document root, or
 * up to and INCLUDING `stopAt` when given. Innermost-first ordering: a tracked
 * change inside a comment highlight returns `[{ trackedChange }, { comment }]`,
 * matching what a switch on `hits[0]` expects when picking the most specific
 * entity.
 *
 * `stopAt` bounds the walk to the visible host: its own attributes are read, but
 * the walk never climbs into an app wrapper ABOVE it, so wrapper data-* cannot
 * leak into the hits. Omitting it keeps the original walk-to-document-root.
 *
 * Returns `[]` for null / non-Element starts. Uses duck-typed `getAttribute`
 * access so it works under any DOM implementation (happy-dom, jsdom, real
 * browser) without an `instanceof` check that could fail across realms.
 */
export function collectEntityHitsFromChain(start: Element | null, stopAt?: Element | null): CollectedEntityHit[] {
  if (!start || typeof (start as { getAttribute?: unknown }).getAttribute !== 'function') {
    return [];
  }

  const hits: CollectedEntityHit[] = [];
  const seen = new Set<string>();
  // Tracked-change hits still waiting to learn their painted story. The painter
  // stamps `data-layout-story` on the fragment container — an ancestor of the
  // run — so a hit found on an inner element only learns its story once the
  // walk reaches the nearest enclosing container. The raw (encoded) string is
  // attached here; the controller decodes it (keeps this leaf dependency-light).
  let pendingStory: CollectedEntityHit[] = [];
  let nearestStoryKey: string | null = null;
  let nearestLayoutStory: string | null = null;
  let el: Element | null = start;
  while (el) {
    const node = el as { getAttribute(name: string): string | null };
    nearestStoryKey ??= node.getAttribute('data-story-key');
    const trackChangeIds = getTrackChangeIds(node);
    // The run/marker element carries the real owning story in `data-story-key`
    // (the layout-story container can fall back to `body` for footnote/endnote
    // bands), so read it off the SAME node and attach it; the controller prefers
    // it over the layout-story locator. Read only when this node is a carrier.
    const storyKey = trackChangeIds.length > 0 ? node.getAttribute('data-story-key') : null;
    for (const trackChangeId of trackChangeIds) {
      const key = `trackedChange:${trackChangeId}`;
      if (!seen.has(key)) {
        seen.add(key);
        const hit: CollectedEntityHit = { type: 'trackedChange', id: trackChangeId };
        if (storyKey) hit.storyKey = storyKey;
        hits.push(hit);
        pendingStory.push(hit);
      }
    }
    const layoutStory = node.getAttribute('data-layout-story');
    nearestLayoutStory ??= layoutStory;
    if (layoutStory && pendingStory.length > 0) {
      // This is the nearest story container for every tracked-change hit
      // gathered below it; stamp it and stop tracking those hits.
      for (const hit of pendingStory) hit.story = layoutStory;
      pendingStory = [];
    }
    const citationId = node.getAttribute('data-citation-id');
    if (citationId) {
      const key = `citation:${citationId}`;
      if (!seen.has(key)) {
        seen.add(key);
        hits.push({ type: 'citation', id: citationId });
      }
    }
    const commentIds = node.getAttribute('data-comment-ids');
    if (commentIds) {
      // The painter stamps overlapping comments as a comma-separated list —
      // surface each id as its own hit so a "Resolve this comment" item in a
      // context menu can target the right one.
      for (const id of parseCommaSeparatedIds(commentIds)) {
        const key = `comment:${id}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({ type: 'comment', id });
        }
      }
    }
    // Content controls (Structured Document Tags). The painter stamps
    // `data-sdt-id` and `data-sdt-type` on every SDT wrapper; only
    // `structuredContent` maps to the Document API's `contentControls.*`
    // namespace, so the walk filters explicitly on that. Nested SDTs surface
    // innermost-first so a switch on `hits[0]` picks the tightest control.
    const sdtType = node.getAttribute('data-sdt-type');
    const sdtId = node.getAttribute('data-sdt-id');
    if (sdtId && sdtType === 'structuredContent') {
      const key = `contentControl:${sdtId}`;
      if (!seen.has(key)) {
        seen.add(key);
        const scopeAttr = node.getAttribute('data-sdt-scope');
        const tag = node.getAttribute('data-sdt-tag');
        const hit: ViewportEntityHit = { type: 'contentControl', id: sdtId };
        if (nearestStoryKey) (hit as CollectedEntityHit).storyKey = nearestStoryKey;
        if (nearestLayoutStory) hit.story = nearestLayoutStory;
        else pendingStory.push(hit);
        if (scopeAttr === 'block' || scopeAttr === 'inline') hit.scope = scopeAttr;
        if (tag) hit.tag = tag;
        hits.push(hit);
      }
    }
    // Stop at the visible host (inclusive): bounds the walk so app-wrapper
    // data-* ABOVE the host can never leak into the hits.
    if (stopAt && el === stopAt) break;
    el = el.parentElement;
  }
  return hits;
}
