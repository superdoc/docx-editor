import { describe, expect, it } from 'vite-plus/test';

import { createV2ReviewTargetSidebarSync, type V2SidebarReviewTarget } from './v2-review-target-sidebar-sync.js';

const MOVE = 'tc|body|move|pair1';
const FROM = `${MOVE}::move-from`;
const TO = `${MOVE}::move-to`;

type HostTarget = {
  entityType: string;
  entityId: string;
  paintedEntityId?: string;
  origin: string;
  layoutEpoch: number;
};

const publicTarget = ({ entityType, entityId, origin, layoutEpoch }: HostTarget) => ({
  entityType,
  entityId,
  origin,
  layoutEpoch,
});

const createHost = () => {
  const listeners = new Set<(target: HostTarget | null) => void>();
  let active: HostTarget | null = null;
  let onEvent: (next: ReturnType<typeof publicTarget> | null) => void = () => {};
  return {
    listenerCount: () => listeners.size,
    review: {
      subscribeActiveReviewTarget: (listener: (target: HostTarget | null) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    forwardEventsTo(handler: typeof onEvent) {
      onEvent = handler;
    },
    setActive(next: HostTarget | null, reason: 'user-click' | 'panel-focus' | 'caret-move') {
      const previous = active;
      active = next;
      const sameEntity = previous?.entityType === next?.entityType && previous?.entityId === next?.entityId;
      if (sameEntity) {
        if (next && previous?.paintedEntityId !== next.paintedEntityId) for (const l of [...listeners]) l(next);
        return;
      }
      if (reason !== 'caret-move') for (const l of [...listeners]) l(next);
      onEvent(next ? publicTarget(next) : null);
    },
  };
};

const target = (entityId: string, paintedEntityId?: string, origin = 'document'): HostTarget => ({
  entityType: 'trackedChange',
  entityId,
  origin,
  layoutEpoch: 1,
  ...(paintedEntityId ? { paintedEntityId } : {}),
});

const setup = () => {
  const activations: (V2SidebarReviewTarget | null | undefined)[] = [];
  const host = createHost();
  const sync = createV2ReviewTargetSidebarSync((next) => activations.push(next));
  sync.attach(host.review);
  host.forwardEventsTo((next) => sync.onReviewTargetChanged(next));
  const paintedIds = () => activations.map((next) => next?.paintedEntityId ?? next?.entityId ?? null);
  return { activations, host, sync, paintedIds };
};

describe('v2 review target sidebar sync', () => {
  it('activates the clicked side through from, to, from on one move, once per click', () => {
    const { host, paintedIds } = setup();
    host.setActive(target(MOVE, FROM), 'user-click');
    host.setActive(target(MOVE, TO), 'user-click');
    host.setActive(target(MOVE, FROM), 'user-click');
    expect(paintedIds()).toEqual([FROM, TO, FROM]);
  });

  it('does not activate again when the same side is clicked twice', () => {
    const { host, paintedIds } = setup();
    host.setActive(target(MOVE, FROM), 'user-click');
    host.setActive(target(MOVE, FROM), 'user-click');
    expect(paintedIds()).toEqual([FROM]);
  });

  it('activates the same change again after a caret move cleared it', () => {
    const { host, paintedIds } = setup();
    host.setActive(target(MOVE, FROM), 'user-click');
    host.setActive(null, 'caret-move');
    host.setActive(target(MOVE, FROM), 'user-click');
    expect(paintedIds()).toEqual([FROM, null, FROM]);
  });

  it('activates the other side once after a caret move cleared the first side', () => {
    const { host, paintedIds } = setup();
    host.setActive(target(MOVE, FROM), 'user-click');
    host.setActive(null, 'caret-move');
    host.setActive(target(MOVE, TO), 'user-click');
    expect(paintedIds()).toEqual([FROM, null, TO]);
  });

  it('forwards an ordinary change exactly as the event reports it', () => {
    const { host, activations } = setup();
    host.setActive(target('insert-1'), 'user-click');
    expect(activations).toEqual([target('insert-1')]);
  });

  it('leaves a panel side change to the panel', () => {
    const { host, activations } = setup();
    host.setActive(target(MOVE, FROM, 'panel'), 'panel-focus');
    host.setActive(target(MOVE, TO, 'panel'), 'panel-focus');
    expect(activations).toHaveLength(1);
    expect(activations[0]).toMatchObject({ origin: 'panel', entityId: MOVE });
  });

  it('activates the document destination after the source was selected in the panel', () => {
    const { host, paintedIds } = setup();
    host.setActive(target(MOVE, FROM, 'panel'), 'panel-focus');
    host.setActive(target(MOVE, TO), 'user-click');
    expect(paintedIds()).toEqual([FROM, TO]);
  });

  it('reactivates the document source after the panel selected the destination', () => {
    const { host, paintedIds } = setup();
    host.setActive(target(MOVE, FROM), 'user-click');
    host.setActive(target(MOVE, TO, 'panel'), 'panel-focus');
    host.setActive(target(MOVE, FROM), 'user-click');
    expect(paintedIds()).toEqual([FROM, FROM]);
  });

  it('uses the event target when the host has no active-target listener', () => {
    const activations: (V2SidebarReviewTarget | null | undefined)[] = [];
    const sync = createV2ReviewTargetSidebarSync((next) => activations.push(next));
    sync.attach({});
    const next = { entityType: 'trackedChange', entityId: MOVE, origin: 'document' };
    sync.onReviewTargetChanged(next);
    expect(activations).toEqual([next]);
  });

  it('removes its host listener on detach and when attached to another host', () => {
    const { host, sync, paintedIds } = setup();
    expect(host.listenerCount()).toBe(1);
    const other = createHost();
    sync.attach(other.review);
    expect(host.listenerCount()).toBe(0);
    expect(other.listenerCount()).toBe(1);
    sync.detach();
    expect(other.listenerCount()).toBe(0);
    other.setActive(target(MOVE, FROM), 'user-click');
    other.setActive(target(MOVE, TO), 'user-click');
    expect(paintedIds()).toEqual([]);
  });
});
