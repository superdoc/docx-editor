import type { AwarenessState, User } from '../types/index.js';

/**
 * Compatibility bridge from the v2 presence runtime to the legacy
 * `awareness-update` public event.
 *
 * The shipped v2 presence facade reports normalized remote-actor snapshots
 * from the bundled browser presence bridge. The legacy
 * public `awareness-update` payload, by contrast, is a v1-shaped
 * `{ states: AwarenessState[], added: number[], removed: number[] }` where
 * `added` / `removed` are numeric client ids.
 *
 * v2 presence identifies actors with stable string ids, not numeric Yjs
 * client ids. To preserve the documented `number[]` public contract this
 * bridge maintains a deterministic string→number registry: each distinct
 * actor key is assigned a stable numeric id the first time it is seen, and
 * that id is reused for the lifetime of the bridge. The local actor always
 * maps to client id `0`.
 */

/** Minimal remote-actor shape consumed from the v2 presence facade snapshot. */
export interface V2AwarenessRemoteActor {
  /** Stable label resolved by the presence facade (userId → displayName → fallback). */
  actorLabel: string;
  displayName?: string | null;
  email?: string | null;
  color?: string | null;
}

/** Minimal presence-facade snapshot shape the bridge reads. */
export interface V2AwarenessSnapshotLike {
  remoteActors: ReadonlyArray<V2AwarenessRemoteActor>;
}

/** Core `awareness-update` payload (the `superdoc` backref is added by the caller). */
interface V2AwarenessPayloadCore {
  states: AwarenessState[];
  added: number[];
  removed: number[];
}

/**
 * Stable string→number id registry. The local actor is reserved id `0`; remote
 * actors are assigned monotonically increasing ids starting at `1`.
 */
export class V2AwarenessIdRegistry {
  #byKey = new Map<string, number>();
  #next = 1;

  idFor(key: string): number {
    const existing = this.#byKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.#next++;
    this.#byKey.set(key, id);
    return id;
  }

  /** True once a key has been assigned an id. */
  has(key: string): boolean {
    return this.#byKey.has(key);
  }
}

/**
 * Stable identity key for a remote actor. Email is preferred because it
 * survives reconnects (which can change a transport-level connection id);
 * otherwise the resolved actor label is used.
 */
function remoteActorKey(actor: V2AwarenessRemoteActor): string {
  const email = typeof actor.email === 'string' && actor.email.length > 0 ? actor.email : null;
  if (email) return `email:${email}`;
  return `label:${actor.actorLabel}`;
}

function remoteActorToState(actor: V2AwarenessRemoteActor, clientId: number): AwarenessState {
  const name = actor.displayName ?? null;
  const email = actor.email ?? null;
  const state: AwarenessState = { clientId };
  if (name) state.name = name;
  if (email) state.email = email;
  if (typeof actor.color === 'string' && actor.color.length > 0) state.color = actor.color;
  return state;
}

function localUserToState(localUser: User | null | undefined): AwarenessState {
  const state: AwarenessState = { clientId: 0 };
  if (localUser?.id != null) state.id = localUser.id;
  if (localUser?.name != null) state.name = localUser.name;
  if (localUser?.email != null) state.email = localUser.email;
  const color = (localUser as { color?: string } | null | undefined)?.color;
  if (typeof color === 'string' && color.length > 0) state.color = color;
  return state;
}

/**
 * Create a stateful presence→awareness differ.
 *
 * Each call to `next(snapshot)` returns the legacy-shaped awareness payload
 * core for that snapshot, computing `added` / `removed` against the previously
 * observed remote-actor set. The local user is always included in `states`.
 */
export function createV2AwarenessDiffer(getLocalUser: () => User | null | undefined) {
  const registry = new V2AwarenessIdRegistry();
  let previousRemoteIds = new Set<number>();

  return {
    registry,
    next(snapshot: V2AwarenessSnapshotLike): V2AwarenessPayloadCore {
      const remoteStates: AwarenessState[] = [];
      const currentRemoteIds = new Set<number>();
      const seenKeys = new Set<string>();

      for (const actor of snapshot.remoteActors) {
        const key = remoteActorKey(actor);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const clientId = registry.idFor(key);
        currentRemoteIds.add(clientId);
        remoteStates.push(remoteActorToState(actor, clientId));
      }

      const added: number[] = [];
      for (const id of currentRemoteIds) {
        if (!previousRemoteIds.has(id)) added.push(id);
      }
      const removed: number[] = [];
      for (const id of previousRemoteIds) {
        if (!currentRemoteIds.has(id)) removed.push(id);
      }
      previousRemoteIds = currentRemoteIds;

      return {
        states: [localUserToState(getLocalUser()), ...remoteStates],
        added,
        removed,
      };
    },
  };
}
