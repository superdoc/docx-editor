export type V2SidebarReviewTarget = {
  origin?: unknown;
  entityId?: unknown;
  entityType?: unknown;
  paintedEntityId?: unknown;
};

type V2ActiveReviewTargetSource = {
  subscribeActiveReviewTarget: (listener: (target: V2SidebarReviewTarget | null) => void) => () => void;
};

const isActiveReviewTargetSource = (source: unknown): source is V2ActiveReviewTargetSource =>
  typeof source === 'object' &&
  source !== null &&
  'subscribeActiveReviewTarget' in source &&
  typeof source.subscribeActiveReviewTarget === 'function';

export type V2ReviewTargetSidebarSync = {
  attach: (source: unknown) => void;
  onReviewTargetChanged: (next: V2SidebarReviewTarget | null | undefined) => void;
  detach: () => void;
};

const isSameEntity = (
  left: V2SidebarReviewTarget | null | undefined,
  right: V2SidebarReviewTarget | null | undefined,
): boolean =>
  !!left &&
  !!right &&
  typeof left.entityId === 'string' &&
  left.entityId === right.entityId &&
  left.entityType === right.entityType;

export function createV2ReviewTargetSidebarSync(
  activate: (target: V2SidebarReviewTarget | null | undefined) => void,
): V2ReviewTargetSidebarSync {
  let latestHostTarget: V2SidebarReviewTarget | null = null;
  let syncedTarget: V2SidebarReviewTarget | null = null;
  let unsubscribe: (() => void) | null = null;

  const detach = () => {
    const stop = unsubscribe;
    unsubscribe = null;
    latestHostTarget = null;
    syncedTarget = null;
    stop?.();
  };

  return {
    attach(source) {
      detach();
      if (!isActiveReviewTargetSource(source)) return;
      unsubscribe = source.subscribeActiveReviewTarget((target) => {
        latestHostTarget = target ?? null;
        if (!target || target.origin !== 'document') {
          syncedTarget = target ?? null;
          return;
        }
        if (!isSameEntity(syncedTarget, target) || syncedTarget?.paintedEntityId === target.paintedEntityId) {
          return;
        }
        syncedTarget = target;
        activate(target);
      });
    },
    onReviewTargetChanged(next) {
      const target =
        isSameEntity(latestHostTarget, next) && latestHostTarget?.origin === next?.origin ? latestHostTarget : next;
      syncedTarget = target ?? null;
      activate(target);
    },
    detach,
  };
}
