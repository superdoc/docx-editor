import { describe, it, expect, vi, afterEach } from 'vite-plus/test';
import { createSuperDocUI } from './create-super-doc-ui.js';
import { SUPERDOC_UI_REASONS } from './reasons.js';
import type { ViewportContext } from './types.js';

// Swap a mocked `elementFromPoint` in for the duration of `run`, restoring the
// original afterwards. happy-dom does not implement point hit-testing, so the
// controller's DOM walk is driven from an explicit element here.
function withElementFromPoint(hit: Element | null, run: () => void): void {
  const docAny = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
  const original = docAny.elementFromPoint;
  docAny.elementFromPoint = () => hit;
  try {
    run();
  } finally {
    if (original) docAny.elementFromPoint = original;
    else delete docAny.elementFromPoint;
  }
}

// Pin an element's client box so point hit-testing is deterministic under
// happy-dom (which does no layout). Used to place / displace pointer-inert
// markers relative to the query point.
function stubRect(el: Element, rect: { left: number; top: number; right: number; bottom: number }): void {
  (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

// Drain pending promise resolutions plus the coalesced microtask recompute the
// async read coordinator schedules when a read settles. Used to let the
// pre-warmed all-story read settle before asserting.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build a controller whose editor host is a real DOM container holding `hit`.
 * The painter stamps `data-track-change-id` directly with the public id, so the
 * slice items mirror whatever ids the test wires onto `hit`.
 */
function makeHitStub(
  hit: Element,
  items: Array<{ id: string; [k: string]: unknown }>,
  trackChangesApi?: Record<string, unknown>,
  editorHost?: Record<string, unknown>,
) {
  const container = document.createElement('div');
  container.appendChild(hit);
  document.body.appendChild(container);
  cleanups.push(() => container.remove());

  const superdoc = {
    activeEditor: {
      mount: { container },
      ...(editorHost ? { host: editorHost } : {}),
      doc: {
        comments: { list: () => ({ items: [] }) },
        selection: { current: () => null },
        // Default body-only stub ignores the `in` scope and returns `items` for
        // every read. Tests that need to distinguish the body-only slice from
        // the internal all-story lookup pass an explicit `trackChangesApi`.
        trackChanges: trackChangesApi ?? { list: () => ({ items }) },
      },
    },
    config: { documentMode: 'editing' },
    on: vi.fn(),
    off: vi.fn(),
  };
  return { superdoc, container };
}

describe('viewport.entityAt / trackChanges.getAt — point hit-testing', () => {
  it('resolves and deduplicates citation identity without changing enclosing entity order', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-citation-id', 'header%3A%2Fword%2Fheader1.xml|CITE0001#7');
    const wrapper = document.createElement('span');
    wrapper.setAttribute('data-citation-id', 'header%3A%2Fword%2Fheader1.xml|CITE0001#7');
    wrapper.setAttribute('data-comment-ids', 'comment-1');
    wrapper.appendChild(hit);
    const { superdoc } = makeHitStub(wrapper, []);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([
        { type: 'citation', id: 'header%3A%2Fword%2Fheader1.xml|CITE0001#7' },
        { type: 'comment', id: 'comment-1' },
      ]);
    });

    ui.destroy();
  });

  it('resolves a painted tracked-change run to a typed hit and a slice item', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const item = { id: 'tc-1', type: 'insert' };
    const { superdoc } = makeHitStub(hit, [item]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([{ type: 'trackedChange', id: 'tc-1' }]);

      const got = ui.trackChanges.getAt({ x: 10, y: 20 });
      expect(got?.id).toBe('tc-1');
      expect(got?.item.id).toBe('tc-1');
    });

    ui.destroy();
  });

  it('number-form entityAt returns null for an entity hit while object-form returns the hits', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      // Object form (the v1-compatible path) still returns the painted hits.
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([{ type: 'trackedChange', id: 'tc-1' }]);
      // Number form fails closed to null: every entity address it could return
      // is one `viewport.getRect` cannot resolve, so it must not hand one back.
      expect(ui.viewport.entityAt(10, 20)).toBeNull();
    });

    ui.destroy();
  });

  it('contextAt composes the painted entities at the point', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      const ctx = ui.viewport.contextAt({ x: 10, y: 20 });
      expect(ctx.point).toEqual({ x: 10, y: 20 });
      expect(ctx.entities).toEqual([{ type: 'trackedChange', id: 'tc-1' }]);
      expect(ctx.position).toBeNull();
      expect(ctx.insideSelection).toBe(false);
      expect(ui.contextMenu.contextAt({ x: 10, y: 20 })).toEqual(ctx);
    });

    ui.destroy();
  });

  it('contextAt returns a copy of the queried point', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      const point = { x: 10, y: 20 };
      const ctx = ui.contextMenu.contextAt(point);
      point.x = 99;
      point.y = 99;
      expect(ctx.point).toEqual({ x: 10, y: 20 });
      expect(ctx.point).not.toBe(point);
    });

    ui.destroy();
  });

  it('contextAt fails closed for malformed input without hit-testing the origin', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    // A real entity is painted under every point, including {0,0}. Malformed
    // input must not reach it through either entry point.
    const docAny = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
    const original = docAny.elementFromPoint;
    const elementFromPoint = vi.fn(() => hit);
    docAny.elementFromPoint = elementFromPoint;
    try {
      for (const input of [null, undefined, {}, { x: '10', y: 20 }] as unknown[]) {
        const viaMenu = ui.contextMenu.contextAt(input as { x: number; y: number });
        expect(viaMenu.entities).toEqual([]);
        expect(viaMenu.point).toEqual({ x: 0, y: 0 });
        expect(ui.viewport.contextAt(input as { x: number; y: number })).toEqual(viaMenu);
      }
      expect(elementFromPoint).not.toHaveBeenCalled();
      // A well-formed point still hit-tests.
      expect(ui.contextMenu.contextAt({ x: 10, y: 20 }).entities).toEqual([{ type: 'trackedChange', id: 'tc-1' }]);
    } finally {
      if (original) docAny.elementFromPoint = original;
      else delete docAny.elementFromPoint;
    }

    ui.destroy();
  });

  it('fails closed (empty / null) when the point carries no painted entity', () => {
    const hit = document.createElement('span'); // no data attributes
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([]);
      expect(ui.viewport.entityAt(10, 20)).toBeNull();
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })).toBeNull();
    });

    ui.destroy();
  });

  it('fails closed (no throw) for a null-ish object-form argument', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    // `typeof null === 'object'` routes null through the object overload; the
    // controller must fail closed to an array / null rather than reading `.x`.
    expect(ui.viewport.entityAt(null as any)).toEqual([]);
    expect(ui.trackChanges.getAt(null as any)).toBeNull();
    // Non-object primitives route to entityAt's NUMBER overload (address|null);
    // getAt must guard them so `hits.length` never throws.
    expect(ui.trackChanges.getAt('nope' as any)).toBeNull();
    expect(ui.trackChanges.getAt(42 as any)).toBeNull();

    ui.destroy();
  });

  it('fails closed for a painted id that is no longer in the track-changes slice', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'stale-id');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([]);
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })).toBeNull();
    });

    ui.destroy();
  });

  it('maps to the public id when it sits on a different carrier than data-track-change-ids (union, not prefer-one)', () => {
    const hit = document.createElement('span');
    // The plural list carries a raw/imported alias that is NOT in the slice...
    hit.setAttribute('data-track-change-ids', 'raw-alias-7');
    // ...while the canonical preferred-target carries the public id that IS.
    hit.setAttribute('data-track-change-preferred-target-id', 'tc-public');
    const item = { id: 'tc-public', type: 'insert' };
    const { superdoc } = makeHitStub(hit, [item]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([{ type: 'trackedChange', id: 'tc-public' }]);
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })?.id).toBe('tc-public');
    });

    ui.destroy();
  });

  it('fails closed when the hit element is outside this controller host', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    // An element the host container does not contain.
    const outside = document.createElement('span');
    outside.setAttribute('data-track-change-id', 'tc-1');
    document.body.appendChild(outside);
    cleanups.push(() => outside.remove());

    withElementFromPoint(outside, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([]);
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })).toBeNull();
    });

    ui.destroy();
  });

  it('resolves via the SuperDoc root element when the mount handle exposes no container (production v2)', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const container = document.createElement('div');
    container.appendChild(hit);
    document.body.appendChild(container);
    cleanups.push(() => container.remove());

    // Production v2: `activeEditor.mount` is a host handle WITHOUT a `container`
    // field; the visible host is reached via `superdoc.element` instead.
    const superdoc = {
      element: container,
      activeEditor: {
        mount: { focus: () => {} },
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [{ id: 'tc-1', type: 'insert' }] }) },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([{ type: 'trackedChange', id: 'tc-1' }]);
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })?.id).toBe('tc-1');
    });

    ui.destroy();
  });

  it('resolves a tracked-change id shared across stories to the painted story’s row', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-dup');
    hit.setAttribute('data-layout-story', 'footnote:fn-1');
    // Same id in two stories; the body row is first to prove story (not order) wins.
    const bodyRow = {
      id: 'tc-dup',
      type: 'insert',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-dup' },
    };
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' };
    const footnoteRow = {
      id: 'tc-dup',
      type: 'insert',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-dup', story: footnoteStory },
    };
    const { superdoc } = makeHitStub(hit, [bodyRow, footnoteRow]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      const got = ui.trackChanges.getAt({ x: 10, y: 20 });
      expect(got?.id).toBe('tc-dup');
      // The footnote occurrence, not the first (body) row.
      expect((got?.item as { address?: { story?: unknown } }).address?.story).toEqual(footnoteStory);

      // object-form entityAt and contextAt carry the resolved story locator.
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([
        { type: 'trackedChange', id: 'tc-dup', story: footnoteStory },
      ]);
      expect(ui.viewport.contextAt({ x: 10, y: 20 }).entities).toEqual([
        { type: 'trackedChange', id: 'tc-dup', story: footnoteStory },
      ]);
    });

    ui.destroy();
  });

  it('reconciles a raw w:id reused across stories within the painted story (not the first story)', () => {
    // The painter stamps the source-level `imported:<w:id>` form when the
    // change's public id isn't threaded into the run yet. Body and footnote are
    // DIFFERENT logical changes (`tc-body` vs `tc-fn`) that reuse the SAME raw
    // `w:id` 27. The alias map must be scoped to the painted story so 27 resolves
    // to the footnote's public id — a global map lets the first (body) row win
    // and the story check then drops the click.
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'imported:27');
    hit.setAttribute('data-layout-story', 'footnote:fn-1');
    const bodyRow = {
      id: 'tc-body',
      type: 'insert',
      sourceIds: { wordIdInsert: '27' },
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-body' },
    };
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' };
    const footnoteRow = {
      id: 'tc-fn',
      type: 'insert',
      sourceIds: { wordIdInsert: '27' },
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-fn', story: footnoteStory },
    };
    // Body first so a global alias map would map 27 -> tc-body (the bug).
    const trackChangesApi = {
      list: (opts?: { in?: string }) => (opts?.in === 'all' ? { items: [bodyRow, footnoteRow] } : { items: [bodyRow] }),
    };
    const { superdoc } = makeHitStub(hit, [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([
        { type: 'trackedChange', id: 'tc-fn', story: footnoteStory },
      ]);
      const got = ui.trackChanges.getAt({ x: 10, y: 20 });
      expect(got?.id).toBe('tc-fn');
      expect((got?.item as { address?: { story?: unknown } }).address?.story).toEqual(footnoteStory);
    });

    ui.destroy();
  });

  it('keeps a body-painted run story-less on every public surface (body-only unchanged)', () => {
    // The painter stamps body fragments with data-layout-story="body". A body
    // story must NOT surface on the public hit (no added `story` field) and must
    // resolve by id alone, so body-only documents behave exactly as before.
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    hit.setAttribute('data-layout-story', 'body');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      // No `story` on the object-form hit or contextAt entities; number-form
      // fails closed to null (no getRect-resolvable address for an entity hit).
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([{ type: 'trackedChange', id: 'tc-1' }]);
      expect(ui.viewport.contextAt({ x: 10, y: 20 }).entities).toEqual([{ type: 'trackedChange', id: 'tc-1' }]);
      expect(ui.viewport.entityAt(10, 20)).toBeNull();
      // getAt still resolves by id alone.
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })?.id).toBe('tc-1');
    });

    ui.destroy();
  });

  it('falls back to id-only matching when the painted run carries no story (body-only unchanged)', () => {
    const hit = document.createElement('span'); // no data-layout-story
    hit.setAttribute('data-track-change-id', 'tc-1');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([{ type: 'trackedChange', id: 'tc-1' }]);
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })?.id).toBe('tc-1');
    });

    ui.destroy();
  });

  it('parses a comma-separated comment-id list, trimming blanks via the shared helper', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-comment-ids', 'c-1, c-2, ,');
    const { superdoc } = makeHitStub(hit, []);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([
        { type: 'comment', id: 'c-1' },
        { type: 'comment', id: 'c-2' },
      ]);
    });

    ui.destroy();
  });

  it('contextAt coerces malformed coordinates and never throws', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    // Pin `elementFromPoint` to null so the fail-closed path is explicit and the
    // test cannot go flaky if the env starts resolving an element at the origin.
    withElementFromPoint(null, () => {
      const ctx = ui.viewport.contextAt(null as any);
      expect(ctx.point).toEqual({ x: 0, y: 0 });
      expect(ctx.entities).toEqual([]);
    });

    ui.destroy();
  });

  it('fails closed (empty / null) for non-finite coordinates (NaN / Infinity)', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    // Even with `elementFromPoint` wired to a real painted hit, non-finite
    // coordinates must be rejected by the guard before any DOM lookup, so the
    // same point never resolves an entity once the coordinate goes NaN/Infinity.
    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: NaN, y: 20 })).toEqual([]);
      expect(ui.viewport.entityAt({ x: 10, y: Infinity })).toEqual([]);
      expect(ui.viewport.entityAt({ x: -Infinity, y: -Infinity })).toEqual([]);
      expect(ui.viewport.entityAt(NaN, 20)).toBeNull();
      expect(ui.viewport.entityAt(Infinity, Infinity)).toBeNull();
      expect(ui.viewport.contextAt({ x: NaN, y: 20 }).entities).toEqual([]);
      expect(ui.trackChanges.getAt({ x: NaN, y: NaN })).toBeNull();
    });

    ui.destroy();
  });

  it('ViewportContext.point is optional — a consumer context that omits it still typechecks', () => {
    const hit = document.createElement('span');
    const { superdoc } = makeHitStub(hit, []);
    const ui = createSuperDocUI({ superdoc });

    // `point` became optional/additive (was required). A custom-UI context built
    // without it must still satisfy `ViewportContext`, so consumer code compiled
    // against the older shape keeps working. The `ViewportContext` annotation is
    // the type-level guard; it would be a compile error if `point` were required.
    const baseSelection = ui.viewport.contextAt({ x: 0, y: 0 }).selection;
    const ctxWithoutPoint: ViewportContext = {
      entities: [],
      selection: baseSelection,
      position: null,
      insideSelection: false,
    };
    expect('point' in ctxWithoutPoint).toBe(false);
    expect(ctxWithoutPoint.point).toBeUndefined();

    ui.destroy();
  });

  it('validates a story-scoped hit against the internal all-story set and resolves it via getAt', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-fn');
    hit.setAttribute('data-layout-story', 'footnote:fn-1');
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' };
    const footnoteRow = {
      id: 'tc-fn',
      type: 'insert',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-fn', story: footnoteStory },
    };
    // Both public inventory and point validation resolve the all-story row.
    const trackChangesApi = {
      list: (opts?: { in?: string }) => (opts?.in === 'all' ? { items: [footnoteRow] } : { items: [] }),
    };
    const { superdoc } = makeHitStub(hit, [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-fn']);

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([
        { type: 'trackedChange', id: 'tc-fn', story: footnoteStory },
      ]);
      const got = ui.trackChanges.getAt({ x: 10, y: 20 });
      expect(got?.id).toBe('tc-fn');
      expect((got?.item as { address?: { story?: unknown } }).address?.story).toEqual(footnoteStory);
    });

    ui.destroy();
  });

  it('fails closed (drops a story-scoped hit) while the all-story validation set is unsettled', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-fn');
    hit.setAttribute('data-layout-story', 'footnote:fn-1');
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' };
    const footnoteRow = {
      id: 'tc-fn',
      type: 'insert',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-fn', story: footnoteStory },
    };
    // The all-story read never settles. A story hit is gated by the current-token
    // validation set, so it must be dropped rather than use stale inventory.
    const trackChangesApi = {
      list: (opts?: { in?: string }) =>
        opts?.in === 'all' ? new Promise<{ items: unknown[] }>(() => {}) : { items: [footnoteRow] },
    };
    const { superdoc } = makeHitStub(hit, [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([]);
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })).toBeNull();
    });

    ui.destroy();
  });

  it('prefers data-story-key over a body layout-story for a footnote tracked change', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-fn');
    // The run carries the real story; the footnote-band fragment's layout-story
    // falls back to body. Story-key must win.
    hit.setAttribute('data-story-key', 'fn:n1');
    hit.setAttribute('data-layout-story', 'body');
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: 'n1' };
    const footnoteRow = {
      id: 'tc-fn',
      type: 'insert',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-fn', story: footnoteStory },
    };
    const trackChangesApi = {
      list: (opts?: { in?: string }) => (opts?.in === 'all' ? { items: [footnoteRow] } : { items: [] }),
    };
    const { superdoc } = makeHitStub(hit, [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-fn']);

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([
        { type: 'trackedChange', id: 'tc-fn', story: footnoteStory },
      ]);
      const got = ui.trackChanges.getAt({ x: 10, y: 20 });
      expect(got?.id).toBe('tc-fn');
      expect((got?.item as { address?: { story?: unknown } }).address?.story).toEqual(footnoteStory);
    });

    ui.destroy();
  });

  it('prefers data-story-key over a body layout-story for an endnote tracked change', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-en');
    hit.setAttribute('data-story-key', 'en:n2');
    hit.setAttribute('data-layout-story', 'body');
    const endnoteStory = { kind: 'story', storyType: 'endnote', noteId: 'n2' };
    const endnoteRow = {
      id: 'tc-en',
      type: 'insert',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-en', story: endnoteStory },
    };
    const trackChangesApi = {
      list: (opts?: { in?: string }) => (opts?.in === 'all' ? { items: [endnoteRow] } : { items: [] }),
    };
    const { superdoc } = makeHitStub(hit, [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-en']);

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([
        { type: 'trackedChange', id: 'tc-en', story: endnoteStory },
      ]);
      const got = ui.trackChanges.getAt({ x: 10, y: 20 });
      expect(got?.id).toBe('tc-en');
      expect((got?.item as { address?: { story?: unknown } }).address?.story).toEqual(endnoteStory);
    });

    ui.destroy();
  });

  it('threads the painted story through getAt -> setActive -> accept to the decide call', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-fn');
    hit.setAttribute('data-layout-story', 'footnote:fn-1');
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' };
    const footnoteRow = {
      id: 'tc-fn',
      type: 'insert',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-fn', story: footnoteStory },
    };
    const decide = vi.fn(() => ({ success: true }));
    const accept = vi.fn(() => ({ success: true }));
    // The footnote change lives only in the all-story read; the body-only slice
    // is empty. A legacy per-id `accept` exists but cannot carry a story, so the
    // story-scoped decision routed from the hit must skip it and reach `decide`.
    const trackChangesApi = {
      list: (opts?: { in?: string }) => (opts?.in === 'all' ? { items: [footnoteRow] } : { items: [] }),
      accept,
      decide,
    };
    const { superdoc } = makeHitStub(hit, [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      const got = ui.trackChanges.getAt({ x: 10, y: 20 });
      expect(got?.id).toBe('tc-fn');
      expect(got?.story).toEqual(footnoteStory);

      // The same hit object flows through setActive and accept; the painted
      // story must survive to the Document API decide call.
      ui.trackChanges.setActive(got!);
      expect(ui.trackChanges.accept(got!)).toEqual({ success: true });
      expect(decide).toHaveBeenCalledWith({
        decision: 'accept',
        target: { kind: 'id', id: 'tc-fn', story: footnoteStory },
      });
      expect(accept).not.toHaveBeenCalled();
    });

    ui.destroy();
  });

  it('walks up to and including the host but never into an app wrapper above it', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const { superdoc, container } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }]);
    // An entity ON the host must still resolve (the walk includes the host)...
    container.setAttribute('data-comment-ids', 'host-comment');
    // ...while an app wrapper ABOVE the host must NOT leak its unrelated data-*.
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-comment-ids', 'outer');
    container.parentElement!.insertBefore(wrapper, container);
    wrapper.appendChild(container);
    cleanups.push(() => wrapper.remove());
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([
        { type: 'trackedChange', id: 'tc-1' },
        { type: 'comment', id: 'host-comment' },
      ]);
    });

    ui.destroy();
  });

  it('resolves a pointer-inert list-marker carrier found geometrically', () => {
    // The marker glyph is pointer-events:none, so elementFromPoint returns the
    // block container behind it; the inert marker (which carries the dataset)
    // must be found by rect containment in the container subtree.
    const marker = document.createElement('span');
    marker.setAttribute('data-track-change-id', 'tc-m');
    marker.setAttribute('data-track-change-marker', 'list');
    marker.style.pointerEvents = 'none';
    stubRect(marker, { left: 0, top: 0, right: 100, bottom: 100 });
    const block = document.createElement('div');
    block.appendChild(marker);
    const { superdoc } = makeHitStub(block, [{ id: 'tc-m', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(block, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([{ type: 'trackedChange', id: 'tc-m' }]);
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })?.id).toBe('tc-m');
    });

    ui.destroy();
  });

  it('does not spuriously resolve a marker whose rect excludes the point', () => {
    const marker = document.createElement('span');
    marker.setAttribute('data-track-change-id', 'tc-m');
    marker.setAttribute('data-track-change-marker', 'list');
    marker.style.pointerEvents = 'none';
    // The marker box is far from the query point, so it must not be collected.
    stubRect(marker, { left: 500, top: 500, right: 600, bottom: 600 });
    const block = document.createElement('div');
    block.appendChild(marker);
    const { superdoc } = makeHitStub(block, [{ id: 'tc-m', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(block, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([]);
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })).toBeNull();
    });

    ui.destroy();
  });

  it('orders an inert list marker ahead of its enclosing comment block', () => {
    // A pointer-inert tracked list marker sits INSIDE a commented block. The
    // block is the elementFromPoint result (the marker is inert); the marker is
    // found geometrically. The marker is the deeper, more specific carrier, so
    // walking up from it must yield its tracked change FIRST and the block's
    // comment AFTER. Walking the block chain first (the pre-fix order) would
    // surface the outer comment as hits[0], violating innermost-first.
    const marker = document.createElement('span');
    marker.setAttribute('data-track-change-id', 'tc-m');
    marker.setAttribute('data-track-change-marker', 'list');
    marker.style.pointerEvents = 'none';
    stubRect(marker, { left: 0, top: 0, right: 100, bottom: 100 });
    const block = document.createElement('div');
    block.setAttribute('data-comment-ids', 'cmt-1');
    block.appendChild(marker);
    const { superdoc } = makeHitStub(block, [{ id: 'tc-m', type: 'insert' }]);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(block, () => {
      const hits = ui.viewport.entityAt({ x: 10, y: 20 });
      expect(hits).toEqual([
        { type: 'trackedChange', id: 'tc-m' },
        { type: 'comment', id: 'cmt-1' },
      ]);
      // The most specific entity under the point is the marker's tracked change.
      expect(hits[0]).toEqual({ type: 'trackedChange', id: 'tc-m' });
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })?.id).toBe('tc-m');
    });

    ui.destroy();
  });

  it('drops a story-scoped hit when the all-story items hold its id only under a different story', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-dup');
    // Painted in footnote fn-1...
    hit.setAttribute('data-layout-story', 'footnote:fn-1');
    // ...but the only all-story row for tc-dup lives in a DIFFERENT story (fn-2).
    const otherStory = { kind: 'story', storyType: 'footnote', noteId: 'fn-2' };
    const otherStoryRow = {
      id: 'tc-dup',
      type: 'insert',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-dup', story: otherStory },
    };
    // Old id-only validation survived the hit (the id exists in the all-story
    // set), yet getAt (id+story) resolved null — inconsistent. id+story
    // validation drops the hit here because no all-story row matches id AND the
    // painted story fn-1, so entityAt and getAt agree.
    const trackChangesApi = {
      list: (opts?: { in?: string }) => (opts?.in === 'all' ? { items: [otherStoryRow] } : { items: [] }),
    };
    const { superdoc } = makeHitStub(hit, [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    withElementFromPoint(hit, () => {
      expect(ui.viewport.entityAt({ x: 10, y: 20 })).toEqual([]);
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })).toBeNull();
    });

    ui.destroy();
  });

  it('getAt surfaces the resolved story on a non-body hit and omits it for a body hit', () => {
    // Non-body hit: getAt returns the story the occurrence resolved with, so a
    // consumer can pass it straight back to setActive({ id, story }).
    const fnHit = document.createElement('span');
    fnHit.setAttribute('data-track-change-id', 'tc-fn');
    fnHit.setAttribute('data-layout-story', 'footnote:fn-1');
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' };
    const footnoteRow = {
      id: 'tc-fn',
      type: 'insert',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-fn', story: footnoteStory },
    };
    const fnApi = {
      list: (opts?: { in?: string }) => (opts?.in === 'all' ? { items: [footnoteRow] } : { items: [] }),
    };
    const { superdoc: fnSuperdoc } = makeHitStub(fnHit, [], fnApi);
    const fnUi = createSuperDocUI({ superdoc: fnSuperdoc });
    withElementFromPoint(fnHit, () => {
      const got = fnUi.trackChanges.getAt({ x: 10, y: 20 });
      expect(got?.id).toBe('tc-fn');
      expect(got?.story).toEqual(footnoteStory);
    });
    fnUi.destroy();

    // Body hit: no `story` field at all (body-only documents stay byte-for-byte).
    const bodyHit = document.createElement('span');
    bodyHit.setAttribute('data-track-change-id', 'tc-1');
    bodyHit.setAttribute('data-layout-story', 'body');
    const { superdoc: bodySuperdoc } = makeHitStub(bodyHit, [{ id: 'tc-1', type: 'insert' }]);
    const bodyUi = createSuperDocUI({ superdoc: bodySuperdoc });
    withElementFromPoint(bodyHit, () => {
      const got = bodyUi.trackChanges.getAt({ x: 10, y: 20 });
      expect(got?.id).toBe('tc-1');
      expect(got && 'story' in got).toBe(false);
    });
    bodyUi.destroy();
  });
});

describe('trackChanges.setActive — story-aware activation + all-story pre-warm', () => {
  const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' };
  const makeFootnoteRow = (id = 'tc-fn') => ({
    id,
    type: 'insert',
    address: { kind: 'entity', entityType: 'trackedChange', entityId: id, story: footnoteStory },
  });

  it('mirrors custom-panel activation into the host review focus', () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-1');
    const setActiveReviewTarget = vi.fn(() => null);
    const { superdoc } = makeHitStub(hit, [{ id: 'tc-1', type: 'insert' }], undefined, {
      getHandles: () => ({
        layout: { generation: 7 },
        review: {
          setActiveReviewTarget,
        },
      }),
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-1')).toBe(true);
    expect(setActiveReviewTarget).toHaveBeenCalledWith({
      entityType: 'trackedChange',
      entityId: 'tc-1',
      origin: 'panel',
      layoutEpoch: 7,
      story: { kind: 'story', storyType: 'body' },
    });

    ui.destroy();
  });

  it('infers a non-body story when a custom panel activates its canonical id', () => {
    const footnoteRow = makeFootnoteRow();
    const setActiveReviewTarget = vi.fn(() => null);
    const trackChangesApi = {
      list: () => ({ items: [footnoteRow] }),
    };
    const { superdoc } = makeHitStub(document.createElement('span'), [], trackChangesApi, {
      getHandles: () => ({
        layout: { generation: 8 },
        review: { setActiveReviewTarget },
      }),
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-fn')).toBe(true);
    expect(setActiveReviewTarget).toHaveBeenCalledWith({
      entityType: 'trackedChange',
      entityId: 'tc-fn',
      origin: 'panel',
      layoutEpoch: 8,
      story: footnoteStory,
    });

    ui.destroy();
  });

  it('keeps default navigation body-scoped, then includes non-body rows after explicit story focus', () => {
    const bodyOne = { id: 'tc-body-1', type: 'insert' };
    const header = {
      id: 'tc-header',
      type: 'insert',
      address: {
        kind: 'entity',
        entityType: 'trackedChange',
        entityId: 'tc-header',
        story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId8' },
      },
    };
    const bodyTwo = { id: 'tc-body-2', type: 'insert' };
    const trackChangesApi = { list: () => ({ items: [bodyOne, header, bodyTwo] }) };
    const { superdoc } = makeHitStub(document.createElement('span'), [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.next()).toBe('tc-body-1');
    expect(ui.trackChanges.next()).toBe('tc-body-2');
    expect(ui.trackChanges.setActive('tc-header')).toBe(true);
    expect(ui.trackChanges.next()).toBe('tc-body-2');

    ui.destroy();
  });

  it('navigates the all-story feed when a document has no body changes', () => {
    const footnoteRow = makeFootnoteRow();
    const trackChangesApi = { list: () => ({ items: [footnoteRow] }) };
    const { superdoc } = makeHitStub(document.createElement('span'), [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.next()).toBe('tc-fn');

    ui.destroy();
  });

  it.each([
    { entityType: 'trackedChange', expectedClears: 1 },
    { entityType: 'comment', expectedClears: 0 },
  ])('clears only a tracked-change host focus when panel activation is cleared', ({ entityType, expectedClears }) => {
    const clearActiveReviewTarget = vi.fn();
    const { superdoc } = makeHitStub(document.createElement('span'), [], undefined, {
      getHandles: () => ({
        review: {
          getActiveReviewTarget: () => ({ entityType, entityId: 'entity-1' }),
          clearActiveReviewTarget,
        },
      }),
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive(null)).toBe(true);
    expect(clearActiveReviewTarget).toHaveBeenCalledTimes(expectedClears);

    ui.destroy();
  });

  it('setActive({ id, story }) keeps a story-scoped change active, validated against the all-story cache', () => {
    const footnoteRow = makeFootnoteRow();
    // The story-aware activation is validated against the current-token cache.
    const trackChangesApi = {
      list: (opts?: { in?: string }) => (opts?.in === 'all' ? { items: [footnoteRow] } : { items: [] }),
    };
    const { superdoc } = makeHitStub(document.createElement('span'), [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-fn']);

    ui.trackChanges.setActive({ id: 'tc-fn', story: footnoteStory });
    // setActive recomputes; the story-aware validation routes through the settled
    // all-story cache and keeps the activation. Public activeId stays the bare id.
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-fn');

    ui.destroy();
  });

  it('disambiguates a duplicated id: footnote story keeps the footnote row, a wrong story clears, a string selects the body', () => {
    const bodyRow = {
      id: 'tc-dup',
      type: 'insert',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-dup' },
    };
    const footnoteRow = makeFootnoteRow('tc-dup');
    // The all-story read carries both occurrences.
    const trackChangesApi = {
      list: (opts?: { in?: string }) => (opts?.in === 'all' ? { items: [bodyRow, footnoteRow] } : { items: [bodyRow] }),
    };
    const { superdoc } = makeHitStub(document.createElement('span'), [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    // Footnote-scoped activation: validated against the all-story footnote row.
    expect(ui.trackChanges.setActive({ id: 'tc-dup', story: footnoteStory })).toBe(true);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-dup');

    // A story NOT present for this id fails closed without clobbering the
    // current focus — proves the story (not just the id) is checked, so the
    // same-id body row can't shadow a missing occurrence.
    const absentStory = { kind: 'story', storyType: 'headerFooterPart', refId: 'h9' };
    expect(ui.trackChanges.setActive({ id: 'tc-dup', story: absentStory })).toBe(false);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-dup');

    // A bare canonical id resolves from the public all-story feed.
    expect(ui.trackChanges.setActive('tc-dup')).toBe(true);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-dup');

    ui.destroy();
  });

  it('reconciles a raw w:id reused across stories to the painted story’s public id', () => {
    // `imported:27` is the source-level alias both a body change (`tc-body`) and
    // a footnote change (`tc-fn`) expose via the same raw `w:id`. A story-scoped
    // activation must reconcile the alias within the footnote rows so it lands on
    // `tc-fn`; a global alias map maps it to the first (body) row and the
    // footnote story check then rejects the activation.
    const bodyRow = {
      id: 'tc-body',
      type: 'insert',
      sourceIds: { wordIdInsert: '27' },
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-body' },
    };
    const footnoteRow = {
      id: 'tc-fn',
      type: 'insert',
      sourceIds: { wordIdInsert: '27' },
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-fn', story: footnoteStory },
    };
    const trackChangesApi = {
      list: (opts?: { in?: string }) => (opts?.in === 'all' ? { items: [bodyRow, footnoteRow] } : { items: [bodyRow] }),
    };
    const setActiveReviewTarget = vi.fn(() => null);
    const { superdoc } = makeHitStub(document.createElement('span'), [], trackChangesApi, {
      getHandles: () => ({
        layout: { generation: 9 },
        review: { setActiveReviewTarget },
      }),
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive({ id: 'imported:27', story: footnoteStory })).toBe(true);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-fn');
    expect(setActiveReviewTarget).toHaveBeenCalledWith({
      entityType: 'trackedChange',
      entityId: 'tc-fn',
      paintedEntityId: 'imported:27',
      origin: 'panel',
      layoutEpoch: 9,
      story: footnoteStory,
    });

    ui.destroy();
  });

  it('fails closed for story-scoped setActive while the all-story read is still pending', () => {
    // The all-story read never settles.
    const trackChangesApi = {
      list: (opts?: { in?: string }) =>
        opts?.in === 'all' ? new Promise<{ items: unknown[] }>(() => {}) : { items: [] },
    };
    const { superdoc } = makeHitStub(document.createElement('span'), [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive({ id: 'tc-fn', story: footnoteStory })).toBe(false);
    // A transient pending read must not accept the activation: the boolean
    // contract means story-scoped activation only succeeds after validation.
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();

    ui.destroy();
  });

  it('pre-warms the all-story cache so the first non-body getAt resolves without a prior hit-test; string setActive on a body id is unchanged', async () => {
    const hit = document.createElement('span');
    hit.setAttribute('data-track-change-id', 'tc-fn');
    hit.setAttribute('data-layout-story', 'footnote:fn-1');
    const footnoteRow = makeFootnoteRow();
    const bodyRow = { id: 'tc-body', type: 'insert' };
    // The all-story read is ASYNC: without pre-warm the FIRST getAt would reach
    // the pending path and drop the click. The body change feeds the public slice.
    const trackChangesApi = {
      list: (opts?: { in?: string }) =>
        opts?.in === 'all' ? Promise.resolve({ items: [bodyRow, footnoteRow] }) : { items: [bodyRow] },
    };
    const { superdoc } = makeHitStub(hit, [], trackChangesApi);
    const ui = createSuperDocUI({ superdoc });

    // compute (not a manual hit-test) initiated the all-story read; let it settle.
    await flush();

    withElementFromPoint(hit, () => {
      // First-ever hit-test on this controller already resolves the footnote change.
      expect(ui.trackChanges.getAt({ x: 10, y: 20 })?.id).toBe('tc-fn');
    });

    // String setActive on a body id stays valid in the widened feed.
    ui.trackChanges.setActive('tc-body');
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-body');

    ui.destroy();
  });

  it('keeps the requested tracked change active when scroll resolves the target but cannot make it visible', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: false, reason: SUPERDOC_UI_REASONS.targetNotVisible }));
    const target = { kind: 'text', segments: [{ blockId: 'p-next', range: { start: 0, end: 1 } }] };
    const { superdoc } = makeHitStub(
      document.createElement('span'),
      [
        {
          id: 'tc-prev',
          type: 'insert',
          target: { kind: 'text', segments: [{ blockId: 'p-prev', range: { start: 0, end: 1 } }] },
        },
        { id: 'tc-next', type: 'insert', target },
      ],
      undefined,
      { scrollTargetIntoView },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-prev')).toBe(true);
    const result = await ui.trackChanges.scrollTo('tc-next');

    expect(result).toEqual({ success: false, ok: false, reason: SUPERDOC_UI_REASONS.targetNotVisible });
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      {
        target,
        block: 'center',
        behavior: 'auto',
      },
      expect.any(Function),
    );
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-next');

    ui.destroy();
  });

  it('rolls back tracked-change focus when scroll fails because the target is unresolved', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: false, reason: SUPERDOC_UI_REASONS.targetUnresolved }));
    const { superdoc } = makeHitStub(
      document.createElement('span'),
      [
        {
          id: 'tc-prev',
          type: 'insert',
          target: { kind: 'text', segments: [{ blockId: 'p-prev', range: { start: 0, end: 1 } }] },
        },
        {
          id: 'tc-next',
          type: 'insert',
          target: { kind: 'text', segments: [{ blockId: 'p-next', range: { start: 0, end: 1 } }] },
        },
      ],
      undefined,
      { scrollTargetIntoView },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-prev')).toBe(true);
    const result = await ui.trackChanges.scrollTo('tc-next');

    expect(result).toEqual({ success: false, ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-prev');

    ui.destroy();
  });

  it('preserves the previous host review target when tracked-change scrolling rolls back', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: false, reason: SUPERDOC_UI_REASONS.targetUnresolved }));
    const previousHostTarget = {
      entityType: 'comment',
      entityId: 'comment-1',
      origin: 'document',
      layoutEpoch: 4,
    };
    let activeHostTarget: unknown = previousHostTarget;
    const setActiveReviewTarget = vi.fn((target: unknown) => {
      activeHostTarget = target;
      return null;
    });
    const clearActiveReviewTarget = vi.fn(() => {
      activeHostTarget = null;
    });
    const { superdoc } = makeHitStub(
      document.createElement('span'),
      [
        {
          id: 'tc-next',
          type: 'insert',
          target: { kind: 'text', segments: [{ blockId: 'p-next', range: { start: 0, end: 1 } }] },
        },
      ],
      undefined,
      {
        scrollTargetIntoView,
        getHandles: () => ({
          layout: { generation: 5 },
          review: {
            setActiveReviewTarget,
            getActiveReviewTarget: () => activeHostTarget,
            clearActiveReviewTarget,
          },
        }),
      },
    );
    const ui = createSuperDocUI({ superdoc });

    await expect(ui.trackChanges.scrollTo('tc-next')).resolves.toEqual({
      success: false,
      ok: false,
      reason: SUPERDOC_UI_REASONS.targetUnresolved,
    });

    expect(activeHostTarget).toBe(previousHostTarget);
    expect(setActiveReviewTarget).not.toHaveBeenCalled();
    expect(clearActiveReviewTarget).not.toHaveBeenCalled();

    ui.destroy();
  });

  it('keeps toolbar navigation focus when the next tracked change resolves but cannot be made visible', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: false, reason: SUPERDOC_UI_REASONS.targetNotVisible }));
    const nextTarget = { kind: 'text', segments: [{ blockId: 'p-next', range: { start: 0, end: 1 } }] };
    const { superdoc } = makeHitStub(
      document.createElement('span'),
      [
        {
          id: 'tc-prev',
          type: 'insert',
          target: { kind: 'text', segments: [{ blockId: 'p-prev', range: { start: 0, end: 1 } }] },
        },
        { id: 'tc-next', type: 'insert', target: nextTarget },
      ],
      undefined,
      { scrollTargetIntoView },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-prev')).toBe(true);
    await expect(ui.trackChanges.navigateNext()).resolves.toEqual({ success: false });

    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      {
        target: nextTarget,
        block: 'center',
        behavior: 'auto',
      },
      expect.any(Function),
    );
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-next');

    ui.destroy();
  });
});
