import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ContentControlsSlice, SelectionSlice } from '../public/ui/types.js';

const bridge = vi.hoisted(() => ({
  observer: null as ((snapshot: ContentControlsSlice) => void) | null,
  initialSnapshot: null as ContentControlsSlice | null,
  observeCount: 0,
  unsubscribe: vi.fn(),
  selectionObserver: null as ((snapshot: SelectionSlice) => void) | null,
  selectionSnapshot: {
    status: 'ready',
    empty: true,
    target: null,
    selectionTarget: null,
    activeMarks: [],
    activeCommentIds: [],
    activeChangeIds: [],
    text: '',
  } as SelectionSlice,
  selectionUnsubscribe: vi.fn(),
}));

vi.mock('./v2-integration/v2-integration.js', () => ({
  loadDefaultV2IntegrationOrFallback: () => new Promise(() => {}),
}));

vi.mock('../public/ui/create-super-doc-ui.js', () => ({
  createSuperDocUI: () => ({
    selection: {
      getSnapshot: () => bridge.selectionSnapshot,
      observe(observer: (snapshot: SelectionSlice) => void) {
        bridge.selectionObserver = observer;
        observer(bridge.selectionSnapshot);
        return bridge.selectionUnsubscribe;
      },
    },
    contentControls: {
      observe() {
        throw new Error('the active-change bridge must not take the catalog lease');
      },
      observeActivePath(observer: (snapshot: ContentControlsSlice) => void) {
        bridge.observeCount += 1;
        bridge.observer = observer;
        if (bridge.observeCount <= 3) {
          observer(
            bridge.initialSnapshot ?? {
              status: 'pending',
              items: [],
              total: 0,
              activeId: null,
              activeIds: [],
            },
          );
        }
        return bridge.unsubscribe;
      },
    },
    destroy: vi.fn(),
  }),
}));

const { SuperDoc } = await import('./SuperDoc.js');
type SuperDocInstance = InstanceType<typeof SuperDoc>;

const instances: SuperDocInstance[] = [];

function contentControl(id: string, kind: 'inline' | 'block', alias: string) {
  return {
    nodeType: 'sdt' as const,
    kind,
    id,
    controlType: 'text' as const,
    lockMode: 'unlocked' as const,
    properties: { alias, tag: `${id}-tag` },
    target: { kind, nodeType: 'sdt' as const, nodeId: id },
  };
}

function publishSelection(activeIds: string[]) {
  const blockId = activeIds.join('-') || 'outside';
  bridge.selectionSnapshot = {
    ...bridge.selectionSnapshot,
    selectionTarget: {
      kind: 'selection',
      start: { kind: 'text', blockId, offset: 0 },
      end: { kind: 'text', blockId, offset: 0 },
    },
  };
  bridge.selectionObserver?.(bridge.selectionSnapshot);
}

function publishContentControls(items: ReturnType<typeof contentControl>[], activeIds: string[]) {
  bridge.observer?.({
    status: 'ready',
    items,
    total: items.length,
    activeId: activeIds[0] ?? null,
    activeIds,
  });
}

function publish(items: ReturnType<typeof contentControl>[], activeIds: string[]) {
  publishSelection(activeIds);
  publishContentControls(items, activeIds);
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  bridge.observer = null;
  bridge.initialSnapshot = null;
  bridge.observeCount = 0;
  bridge.unsubscribe.mockReset();
  bridge.selectionObserver = null;
  bridge.selectionSnapshot = {
    status: 'ready',
    empty: true,
    target: null,
    selectionTarget: null,
    activeMarks: [],
    activeCommentIds: [],
    activeChangeIds: [],
    text: '',
  };
  bridge.selectionUnsubscribe.mockReset();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('onContentControlActiveChange', () => {
  it('reports the active path only when the selected content controls change', () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const onContentControlActiveChange = vi.fn();
    const superdoc = new SuperDoc({
      selector,
      telemetry: { enabled: false },
      onContentControlActiveChange,
    } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);

    const controls = [contentControl('inner', 'inline', 'Inner'), contentControl('outer', 'block', 'Outer')];
    publish(controls, ['inner', 'outer']);
    publish(controls, ['inner', 'outer']);
    publish(controls, ['outer']);
    publish(controls, []);

    expect(onContentControlActiveChange).toHaveBeenCalledTimes(3);
    expect(onContentControlActiveChange.mock.calls).toEqual([
      [
        {
          active: {
            alias: 'Inner',
            controlType: 'text',
            id: 'inner',
            scope: 'inline',
            tag: 'inner-tag',
          },
          previous: null,
          activePath: [
            {
              alias: 'Inner',
              controlType: 'text',
              id: 'inner',
              scope: 'inline',
              tag: 'inner-tag',
            },
            {
              alias: 'Outer',
              controlType: 'text',
              id: 'outer',
              scope: 'block',
              tag: 'outer-tag',
            },
          ],
          source: 'keyboard',
        },
      ],
      [
        {
          active: {
            alias: 'Outer',
            controlType: 'text',
            id: 'outer',
            scope: 'block',
            tag: 'outer-tag',
          },
          previous: {
            alias: 'Inner',
            controlType: 'text',
            id: 'inner',
            scope: 'inline',
            tag: 'inner-tag',
          },
          activePath: [
            {
              alias: 'Outer',
              controlType: 'text',
              id: 'outer',
              scope: 'block',
              tag: 'outer-tag',
            },
          ],
          source: 'keyboard',
        },
      ],
      [
        {
          active: null,
          previous: {
            alias: 'Outer',
            controlType: 'text',
            id: 'outer',
            scope: 'block',
            tag: 'outer-tag',
          },
          activePath: [],
          source: 'keyboard',
        },
      ],
    ]);
  });

  it('reports pointer selection and detaches the observer on destroy', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);
    const selector = document.createElement('div');
    document.body.append(selector);
    const onContentControlActiveChange = vi.fn();
    const superdoc = new SuperDoc({
      selector,
      telemetry: { enabled: false },
      onContentControlActiveChange,
    } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);

    selector.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    now.mockReturnValue(1_000);
    publishSelection(['field']);
    bridge.selectionObserver?.(bridge.selectionSnapshot);
    publishContentControls([contentControl('field', 'inline', 'Field')], ['field']);

    expect(onContentControlActiveChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'pointer', active: expect.objectContaining({ id: 'field' }) }),
    );

    superdoc.destroy();
    instances.pop();
    expect(bridge.unsubscribe).toHaveBeenCalledOnce();
    expect(bridge.selectionUnsubscribe).toHaveBeenCalledOnce();
  });

  it.each(['pointerup', 'pointercancel'])('keeps pointer attribution until %s ends the selection drag', (endEvent) => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const onContentControlActiveChange = vi.fn();
    const superdoc = new SuperDoc({
      selector,
      telemetry: { enabled: false },
      onContentControlActiveChange,
    } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);

    selector.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    publish([contentControl('first', 'inline', 'First')], ['first']);
    publish([contentControl('second', 'inline', 'Second')], ['second']);
    document.dispatchEvent(new PointerEvent(endEvent, { bubbles: true, pointerId: 1 }));
    selector.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    publish([contentControl('third', 'inline', 'Third')], ['third']);

    expect(onContentControlActiveChange.mock.calls.map(([payload]) => payload.source)).toEqual([
      'pointer',
      'pointer',
      'keyboard',
    ]);
  });

  it.each(['pointerup', 'pointercancel'])(
    'retains pointer attribution when the final selection arrives after %s',
    (endEvent) => {
      const selector = document.createElement('div');
      document.body.append(selector);
      const onContentControlActiveChange = vi.fn();
      const superdoc = new SuperDoc({
        selector,
        telemetry: { enabled: false },
        onContentControlActiveChange,
      } as never);
      superdoc.activeEditor = { editorVersion: 2 } as never;
      instances.push(superdoc);

      selector.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      document.dispatchEvent(new PointerEvent(endEvent, { bubbles: true, pointerId: 1 }));
      publish([contentControl('first', 'inline', 'First')], ['first']);
      publish([contentControl('second', 'inline', 'Second')], ['second']);

      expect(onContentControlActiveChange.mock.calls.map(([payload]) => payload.source)).toEqual([
        'pointer',
        'keyboard',
      ]);
    },
  );

  it('retains pointer attribution when a stale old selection precedes the final selection', () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const onContentControlActiveChange = vi.fn();
    const superdoc = new SuperDoc({
      selector,
      telemetry: { enabled: false },
      onContentControlActiveChange,
    } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);

    publishSelection([]);
    selector.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    bridge.selectionSnapshot = { ...bridge.selectionSnapshot, status: 'stale' };
    bridge.selectionObserver?.(bridge.selectionSnapshot);
    bridge.selectionSnapshot = { ...bridge.selectionSnapshot, status: 'ready' };
    publishSelection(['field']);
    publishContentControls([contentControl('field', 'inline', 'Field')], ['field']);

    expect(onContentControlActiveChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'pointer', active: expect.objectContaining({ id: 'field' }) }),
    );
  });

  it.each([
    ['Shift', { key: 'Shift', shiftKey: true }],
    ['Control', { key: 'Control', ctrlKey: true }],
    ['Meta', { key: 'Meta', metaKey: true }],
    ['Alt', { key: 'Alt', altKey: true }],
    ['Ctrl+C', { key: 'c', ctrlKey: true }],
    ['Meta+C', { key: 'c', metaKey: true }],
    ['Ctrl+F', { key: 'f', ctrlKey: true }],
    ['Meta+F', { key: 'f', metaKey: true }],
    ['Ctrl+S', { key: 's', ctrlKey: true }],
    ['Meta+S', { key: 's', metaKey: true }],
    ['Ctrl+B', { key: 'b', ctrlKey: true }],
    ['Meta+B', { key: 'b', metaKey: true }],
    ['Ctrl+I', { key: 'i', ctrlKey: true }],
    ['Meta+I', { key: 'i', metaKey: true }],
    ['Ctrl+U', { key: 'u', ctrlKey: true }],
    ['Meta+U', { key: 'u', metaKey: true }],
    ['Ctrl+Shift+8', { key: '8', code: 'Digit8', ctrlKey: true, shiftKey: true }],
    ['Meta+Shift+*', { key: '*', code: 'Digit8', metaKey: true, shiftKey: true }],
    ['Ctrl+Shift+Digit8', { key: 'Unidentified', code: 'Digit8', ctrlKey: true, shiftKey: true }],
  ])('keeps queued pointer attribution across a non-selection %s keydown', (_label, init) => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const onContentControlActiveChange = vi.fn();
    const superdoc = new SuperDoc({
      selector,
      telemetry: { enabled: false },
      onContentControlActiveChange,
    } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);

    selector.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    selector.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    publish([contentControl('field', 'inline', 'Field')], ['field']);

    expect(onContentControlActiveChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'pointer', active: expect.objectContaining({ id: 'field' }) }),
    );
  });

  it.each([
    ['ArrowRight', { key: 'ArrowRight' }],
    ['Ctrl+A', { key: 'a', ctrlKey: true }],
    ['Meta+A', { key: 'a', metaKey: true }],
  ])('uses keyboard attribution after a selection-changing %s keydown', (_label, init) => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const onContentControlActiveChange = vi.fn();
    const superdoc = new SuperDoc({
      selector,
      telemetry: { enabled: false },
      onContentControlActiveChange,
    } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);

    selector.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    selector.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    publish([contentControl('field', 'inline', 'Field')], ['field']);

    expect(onContentControlActiveChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'keyboard', active: expect.objectContaining({ id: 'field' }) }),
    );
  });

  it.each(['pointerup', 'pointercancel'])(
    'retains pointer attribution when an intermediate drag snapshot settles before %s',
    (endEvent) => {
      const selector = document.createElement('div');
      document.body.append(selector);
      const onContentControlActiveChange = vi.fn();
      const superdoc = new SuperDoc({
        selector,
        telemetry: { enabled: false },
        onContentControlActiveChange,
      } as never);
      superdoc.activeEditor = { editorVersion: 2 } as never;
      instances.push(superdoc);

      selector.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      publish([contentControl('intermediate', 'inline', 'Intermediate')], ['intermediate']);
      document.dispatchEvent(new PointerEvent(endEvent, { bubbles: true, pointerId: 1 }));
      publish([contentControl('final', 'inline', 'Final')], ['final']);
      selector.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
      publish([contentControl('later', 'inline', 'Later')], ['later']);

      expect(onContentControlActiveChange.mock.calls.map(([payload]) => payload.source)).toEqual([
        'pointer',
        'pointer',
        'keyboard',
      ]);
    },
  );

  it.each(['pointerup', 'pointercancel'])(
    'expires pointer attribution after %s when no final selection remains queued',
    (endEvent) => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(100);
      const selector = document.createElement('div');
      document.body.append(selector);
      const onContentControlActiveChange = vi.fn();
      const superdoc = new SuperDoc({
        selector,
        telemetry: { enabled: false },
        onContentControlActiveChange,
      } as never);
      superdoc.activeEditor = { editorVersion: 2 } as never;
      instances.push(superdoc);

      selector.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      publish([contentControl('first', 'inline', 'First')], ['first']);
      document.dispatchEvent(new PointerEvent(endEvent, { bubbles: true, pointerId: 1 }));
      now.mockReturnValue(1_000);
      publish([contentControl('later', 'inline', 'Later')], ['later']);

      expect(onContentControlActiveChange.mock.calls.map(([payload]) => payload.source)).toEqual([
        'pointer',
        'keyboard',
      ]);
    },
  );

  it('ignores pointer end events from another pointer', () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const onContentControlActiveChange = vi.fn();
    const superdoc = new SuperDoc({
      selector,
      telemetry: { enabled: false },
      onContentControlActiveChange,
    } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);

    selector.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    publish([contentControl('first', 'inline', 'First')], ['first']);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    publish([contentControl('second', 'inline', 'Second')], ['second']);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    selector.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    publish([contentControl('third', 'inline', 'Third')], ['third']);

    expect(onContentControlActiveChange.mock.calls.map(([payload]) => payload.source)).toEqual([
      'pointer',
      'pointer',
      'keyboard',
    ]);
  });

  it('starts the bridge for an event listener added after construction', () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const superdoc = new SuperDoc({ selector, telemetry: { enabled: false } } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);
    const payloads: Array<{ active: { id: string } | null }> = [];
    superdoc.on('content-control:active-change', (payload) => payloads.push(payload));

    expect(bridge.observeCount).toBe(1);
    publish([contentControl('field', 'inline', 'Field')], ['field']);

    expect(payloads.at(-1)?.active?.id).toBe('field');
  });

  it('does not reuse selection-source attribution after switching editors', () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const onContentControlActiveChange = vi.fn();
    const superdoc = new SuperDoc({
      selector,
      telemetry: { enabled: false },
      onContentControlActiveChange,
    } as never);
    superdoc.activeEditor = { editorVersion: 2, id: 'first-editor' } as never;
    instances.push(superdoc);

    selector.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    publish([contentControl('field', 'inline', 'Field')], ['field']);
    superdoc.activeEditor = { editorVersion: 2, id: 'second-editor' } as never;
    publishContentControls([contentControl('field', 'inline', 'Field')], ['field']);

    expect(onContentControlActiveChange.mock.calls.map(([payload]) => payload.source)).toEqual(['pointer', 'keyboard']);
  });

  it('detaches the bridge after the last ordinary listener is removed and reinstalls it on demand', () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const superdoc = new SuperDoc({ selector, telemetry: { enabled: false } } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);
    const first = vi.fn();
    const second = vi.fn();
    superdoc.on('content-control:active-change', first);
    superdoc.on('content-control:active-change', second);

    superdoc.off('content-control:active-change', first);
    expect(bridge.unsubscribe).not.toHaveBeenCalled();
    expect(bridge.selectionUnsubscribe).not.toHaveBeenCalled();
    superdoc.removeListener('content-control:active-change', second);

    expect(bridge.unsubscribe).toHaveBeenCalledOnce();
    expect(bridge.selectionUnsubscribe).toHaveBeenCalledOnce();
    superdoc.on('content-control:active-change', vi.fn());
    expect(bridge.observeCount).toBe(2);
  });

  it.each([['content-control:active-change'], []] as const)(
    'detaches the bridge when removeAllListeners receives %j',
    (...events) => {
      const selector = document.createElement('div');
      document.body.append(selector);
      const superdoc = new SuperDoc({ selector, telemetry: { enabled: false } } as never);
      superdoc.activeEditor = { editorVersion: 2 } as never;
      instances.push(superdoc);
      superdoc.on('content-control:active-change', vi.fn());

      superdoc.removeAllListeners(...events);

      expect(bridge.unsubscribe).toHaveBeenCalledOnce();
      expect(bridge.selectionUnsubscribe).toHaveBeenCalledOnce();
    },
  );

  it('detaches the bridge after a once listener fires', () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const active = contentControl('field', 'inline', 'Field');
    bridge.initialSnapshot = {
      status: 'ready',
      items: [active],
      total: 1,
      activeId: active.id,
      activeIds: [active.id],
    };
    const superdoc = new SuperDoc({ selector, telemetry: { enabled: false } } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);
    const listener = vi.fn();
    superdoc.once('content-control:active-change', listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(bridge.unsubscribe).toHaveBeenCalledOnce();
    expect(bridge.selectionUnsubscribe).toHaveBeenCalledOnce();
  });

  it('installs one bridge when the synchronous first event listener reads ui', () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const active = contentControl('field', 'inline', 'Field');
    bridge.initialSnapshot = {
      status: 'ready',
      items: [active],
      total: 1,
      activeId: active.id,
      activeIds: [active.id],
    };
    const superdoc = new SuperDoc({ selector, telemetry: { enabled: false } } as never);
    superdoc.activeEditor = { editorVersion: 2 } as never;
    instances.push(superdoc);
    const payloads: Array<{ active: { id: string } | null }> = [];
    superdoc.on('content-control:active-change', (payload) => {
      payloads.push(payload);
      void superdoc.ui;
    });

    void superdoc.ui;

    expect(bridge.observeCount).toBe(1);
    expect(payloads).toHaveLength(1);
  });
});
