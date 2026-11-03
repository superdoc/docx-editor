export type SharedUiTrackedChangesCatalogState = {
  refCount: number;
  generation: number;
  abortController: AbortController;
  inFlight: {
    generation: number;
    promise: Promise<unknown>;
  } | null;
  activeMutationTokens: Set<string>;
};

export const sharedUiTrackedChangesCatalogByHost = new WeakMap<object, SharedUiTrackedChangesCatalogState>();

export function acquireSharedUiTrackedChangesCatalog(host: object): SharedUiTrackedChangesCatalogState {
  let state = sharedUiTrackedChangesCatalogByHost.get(host);
  if (!state) {
    state = {
      refCount: 0,
      generation: 0,
      abortController: new AbortController(),
      inFlight: null,
      activeMutationTokens: new Set(),
    };
    sharedUiTrackedChangesCatalogByHost.set(host, state);
  }
  state.refCount += 1;
  return state;
}

export function releaseSharedUiTrackedChangesCatalog(host: object, state: SharedUiTrackedChangesCatalogState): void {
  state.refCount = Math.max(0, state.refCount - 1);
  if (state.refCount > 0) return;
  state.abortController.abort('ui-controller-destroyed');
  state.inFlight = null;
  state.activeMutationTokens.clear();
  sharedUiTrackedChangesCatalogByHost.delete(host);
}
