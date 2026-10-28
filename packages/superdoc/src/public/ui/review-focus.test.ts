import { afterEach, describe, expect, it } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';

type Target = {
  entityType: 'comment' | 'trackedChange';
  entityId: string;
  origin?: string;
  layoutEpoch?: number;
} | null;
type Snapshot = { activeReviewTarget: Target; lastInteractionRejection: unknown };

function makeReviewHost() {
  let target: Target = null;
  let layoutEpoch = 1;
  const listeners = new Set<(snapshot: Snapshot) => void>();
  const publish = (next: Target, rejection: unknown = null) => {
    target = next;
    for (const listener of listeners) listener({ activeReviewTarget: target, lastInteractionRejection: rejection });
  };
  return {
    review: {
      getActiveReviewTarget: () => target,
      subscribe: (listener: (snapshot: Snapshot) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setActiveReviewTarget: (next: Target) => publish(next),
      clearActiveReviewTarget: () => publish(null),
    },
    target: () => target,
    click: (entityType: 'comment' | 'trackedChange', entityId: string) =>
      publish({ entityType, entityId, origin: 'document', layoutEpoch }),
    unpaint: () => publish(null, { code: 'review-target-invalidated', detail: 'not-painted' }),
    remove: () => publish(null),
    repaint: () => publish(target ? { ...target, layoutEpoch: ++layoutEpoch } : null),
  };
}

const uis: Array<{ destroy(): void }> = [];
afterEach(() => {
  for (const ui of uis.splice(0)) ui.destroy();
});

function setup(options: { comments?: () => unknown } = {}) {
  const host = makeReviewHost();
  let comments = [{ id: 'c-1', text: 'Check this' }];
  let onHostEvent: (event: Record<string, unknown>) => void = () => undefined;
  let finishScroll: (success: boolean) => void = () => undefined;
  const scrollTargetIntoView = () => new Promise((resolve) => (finishScroll = (success) => resolve({ success })));
  const sdListeners = new Map<string, Array<() => void>>();
  const superdoc: Record<string, unknown> = {
    activeEditor: {
      host: {
        getHandles: () => ({ review: host.review, layout: { generation: 1 } }),
        scrollTargetIntoView,
        events: {
          subscribe: (listener: (event: Record<string, unknown>) => void) => {
            onHostEvent = listener;
            return () => undefined;
          },
        },
      },
      doc: {
        comments: { list: options.comments ?? (() => ({ items: comments })) },
        trackChanges: {
          list: () => ({
            items: [
              {
                id: 'tc-1',
                type: 'insert',
                target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 4 } }] },
              },
            ],
          }),
        },
        selection: { current: () => null },
      },
    },
    config: { documentMode: 'editing' },
    on: (event: string, handler: () => void) => sdListeners.set(event, [...(sdListeners.get(event) ?? []), handler]),
    off: () => undefined,
  };
  const ui = createSuperDocUI({ superdoc });
  uis.push(ui);
  const active = () => ({
    comment: ui.comments.getSnapshot().activeId,
    change: ui.trackChanges.getSnapshot().activeId,
  });
  return {
    ui,
    host,
    active,
    finishScroll: (success: boolean) => finishScroll(success),
    replaceDocument: () => {
      const editor = superdoc.activeEditor as Record<string, unknown>;
      for (const handler of sdListeners.get('document-replaced') ?? []) (handler as (p: unknown) => void)({ editor });
    },
    switchToLoadingEditor: () => {
      superdoc.activeEditor = {
        host: { getHandles: () => ({ review: makeReviewHost().review, layout: { generation: 1 } }) },
        doc: {
          comments: { list: () => new Promise(() => undefined) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => null },
        },
      };
      for (const handler of sdListeners.get('active-editor-change') ?? []) handler();
    },
    deleteComments: () => {
      comments = [];
      onHostEvent({ type: 'document:mutated', hasCommitEvent: false });
    },
  };
}

describe('review focus', () => {
  it('paints a comment focused from a panel', () => {
    const { ui, host } = setup();

    expect(ui.comments.setActive('c-1')).toBe(true);

    expect(host.target()).toMatchObject({ entityType: 'comment', entityId: 'c-1' });
    expect(host.target()).not.toHaveProperty('story');
  });

  it('focuses a comment clicked in the document', () => {
    const { host, active } = setup();

    host.click('comment', 'c-1');

    expect(active()).toEqual({ comment: 'c-1', change: null });
  });

  it('moves focus between kinds in both directions', () => {
    const { ui, host, active } = setup();

    ui.comments.setActive('c-1');
    ui.trackChanges.setActive('tc-1');
    expect(active()).toEqual({ comment: null, change: 'tc-1' });
    expect(host.target()).toMatchObject({ entityType: 'trackedChange', entityId: 'tc-1' });

    ui.comments.setActive('c-1');
    expect(active()).toEqual({ comment: 'c-1', change: null });
    expect(host.target()).toMatchObject({ entityType: 'comment', entityId: 'c-1' });

    host.click('trackedChange', 'tc-1');
    expect(active()).toEqual({ comment: null, change: 'tc-1' });

    host.click('comment', 'c-1');
    expect(active()).toEqual({ comment: 'c-1', change: null });
  });

  it('clearing one kind leaves the other focused', () => {
    const { ui, host, active } = setup();

    ui.comments.setActive('c-1');
    ui.trackChanges.setActive(null);

    expect(active()).toEqual({ comment: 'c-1', change: null });
    expect(host.target()).toMatchObject({ entityType: 'comment', entityId: 'c-1' });

    ui.comments.setActive(null);
    expect(active()).toEqual({ comment: null, change: null });
    expect(host.target()).toBeNull();
  });

  it('keeps comment focus while its text is briefly unpainted', () => {
    const { ui, host, active } = setup();

    ui.comments.setActive('c-1');
    host.unpaint();

    expect(active().comment).toBe('c-1');
  });

  it('drops comment focus when the host drops its comment target', () => {
    const { host, active } = setup();

    host.click('comment', 'c-1');
    host.remove();

    expect(active().comment).toBeNull();
  });

  it('drops comment focus when the comment is deleted', async () => {
    const { ui, host, active, deleteComments } = setup();

    ui.comments.setActive('c-1');
    host.unpaint();
    deleteComments();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(active().comment).toBeNull();
  });

  it('drops review focus when another editor becomes active', () => {
    const { ui, active, switchToLoadingEditor } = setup();

    ui.comments.setActive('c-1');
    switchToLoadingEditor();

    expect(active()).toEqual({ comment: null, change: null });
  });

  it('drops review focus when the document is replaced', () => {
    const { ui, active, replaceDocument } = setup();

    ui.trackChanges.setActive('tc-1');
    replaceDocument();

    expect(active()).toEqual({ comment: null, change: null });
  });

  it('focuses a comment clicked before the comment list has loaded', async () => {
    let load: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => (load = resolve));
    const { ui, host, active } = setup({ comments: () => pending });
    const stop = ui.comments.observe(() => undefined);

    host.click('comment', 'c-1');
    load({ items: [{ id: 'c-1', text: 'Check this' }] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(active().comment).toBe('c-1');
    stop();
  });

  it('a comment focused while a tracked change is scrolling into view keeps focus when that scroll fails', async () => {
    const { ui, host, active, finishScroll } = setup();

    const scrolling = ui.trackChanges.scrollTo('tc-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(active().change).toBe('tc-1');

    ui.comments.setActive('c-1');
    finishScroll(false);
    await scrolling;

    expect(host.target()).toMatchObject({ entityType: 'comment', entityId: 'c-1' });

    expect(active()).toEqual({ comment: 'c-1', change: null });
  });

  it('a tracked-change scroll that fails gives focus back to the comment that had it', async () => {
    const { ui, host, active, finishScroll } = setup();

    ui.comments.setActive('c-1');
    const scrolling = ui.trackChanges.scrollTo('tc-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishScroll(false);
    await scrolling;

    expect(active()).toEqual({ comment: 'c-1', change: null });
    expect(host.target()).toMatchObject({ entityType: 'comment', entityId: 'c-1' });
  });

  it('a second click on a comment takes focus from a tracked-change scroll', async () => {
    const { ui, host, active } = setup();

    host.click('comment', 'c-1');
    void ui.trackChanges.scrollTo('tc-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.repaint();
    host.click('comment', 'c-1');

    expect(active()).toEqual({ comment: 'c-1', change: null });
  });

  it('a click on the comment the panel focused takes focus from a tracked-change scroll', async () => {
    const { ui, host, active } = setup();

    ui.comments.setActive('c-1');
    void ui.trackChanges.scrollTo('tc-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.click('comment', 'c-1');

    expect(active()).toEqual({ comment: 'c-1', change: null });
  });

  it('a failed tracked-change scroll does not undo a focus an observer set during its rollback', async () => {
    const { ui, host, active, finishScroll } = setup({
      comments: () => ({ items: [{ id: 'c-1' }, { id: 'c-2' }] }),
    });

    ui.comments.setActive('c-1');
    const scrolling = ui.trackChanges.scrollTo('tc-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    let redirected = false;
    const stop = ui.comments.subscribe(({ snapshot }) => {
      if (snapshot.activeId !== 'c-1' || redirected) return;
      redirected = true;
      ui.comments.setActive('c-2');
    });
    finishScroll(false);
    await scrolling;
    stop();

    expect(redirected).toBe(true);
    expect(active().comment).toBe('c-2');
    expect(host.target()).toMatchObject({ entityType: 'comment', entityId: 'c-2' });
  });

  it('a host republishing its comment target during a tracked-change scroll does not take focus back', async () => {
    const { ui, host, active, finishScroll } = setup();

    host.click('comment', 'c-1');
    const scrolling = ui.trackChanges.scrollTo('tc-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.repaint();
    expect(active()).toEqual({ comment: null, change: 'tc-1' });

    finishScroll(true);
    await scrolling;
    expect(active()).toEqual({ comment: null, change: 'tc-1' });
  });
});
