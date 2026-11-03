import { describe, expect, it, vi } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';
import type { ContentControlClickPayload, SuperDocUI } from './types.js';

type Handler = (payload: unknown) => void;

function makeHost(): {
  ui: SuperDocUI;
  emit: (event: string, payload: unknown) => void;
  listenerCount: (event: string) => number;
} {
  const listeners = new Map<string, Set<Handler>>();
  const superdoc = {
    activeEditor: { editorVersion: 2, doc: {} },
    on(event: string, handler: Handler): void {
      const registered = listeners.get(event) ?? new Set<Handler>();
      registered.add(handler);
      listeners.set(event, registered);
    },
    off(event: string, handler: Handler): void {
      listeners.get(event)?.delete(handler);
    },
  };
  return {
    ui: createSuperDocUI({ superdoc: superdoc as never }),
    emit: (event, payload) => {
      for (const handler of Array.from(listeners.get(event) ?? [])) handler(payload);
    },
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
  };
}

const CLICK: ContentControlClickPayload = {
  target: { id: 'client-name', alias: 'Client name', tag: 'client', controlType: 'text', scope: 'inline' },
  source: 'pointer',
};

describe('ui.contentControls.onClick', () => {
  it('reports repeated clicks on the same control, which the slices do not', () => {
    const { ui, emit } = makeHost();
    const clicks: ContentControlClickPayload[] = [];
    const activePathSnapshots = vi.fn();
    const stopClicks = ui.contentControls.onClick((payload) => clicks.push(payload));
    const stopActivePath = ui.contentControls.observeActivePath(activePathSnapshots);
    try {
      activePathSnapshots.mockClear();
      emit('content-control:click', CLICK);
      emit('content-control:click', CLICK);

      expect(clicks).toEqual([CLICK, CLICK]);
      expect(activePathSnapshots).not.toHaveBeenCalled();
    } finally {
      stopClicks();
      stopActivePath();
      ui.destroy();
    }
  });

  it('stops reporting after its unsubscribe, leaving other listeners live', () => {
    const { ui, emit } = makeHost();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = ui.contentControls.onClick(first);
    ui.contentControls.onClick(second);
    try {
      emit('content-control:click', CLICK);
      stopFirst();
      emit('content-control:click', CLICK);

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(2);
    } finally {
      ui.destroy();
    }
  });

  it('holds one instance subscription for every listener and releases it on destroy', () => {
    const { ui, emit, listenerCount } = makeHost();
    const listener = vi.fn();
    ui.contentControls.onClick(listener);
    ui.contentControls.onClick(vi.fn());

    expect(listenerCount('content-control:click')).toBe(1);

    ui.destroy();
    emit('content-control:click', CLICK);

    expect(listenerCount('content-control:click')).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(ui.contentControls.onClick(vi.fn())).toBeInstanceOf(Function);
  });

  it('drops a payload that is not a content-control click rather than handing it on', () => {
    const { ui, emit } = makeHost();
    const listener = vi.fn();
    ui.contentControls.onClick(listener);
    try {
      for (const payload of [
        undefined,
        null,
        {},
        { source: 'pointer' },
        { source: 'keyboard', target: CLICK.target },
        { source: 'pointer', target: { id: 'no-type', scope: 'inline' } },
        { source: 'pointer', target: { id: 'no-scope', controlType: 'text' } },
        { source: 'pointer', target: { ...CLICK.target, id: 42 } },
      ]) {
        emit('content-control:click', payload);
      }

      expect(listener).not.toHaveBeenCalled();
    } finally {
      ui.destroy();
    }
  });
});
