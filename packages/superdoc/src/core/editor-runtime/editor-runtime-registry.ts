// SuperDoc-owned editor runtime registry + active routing.
//
// The registry is the ONE internal place SuperDoc asks "which mounted editor
// runtime is active?" and "which runtime owns this DOM event target?". It tracks
// more than one mounted runtime at a time and decides which one is active.
//
// Boundary rules (the runtime contract, enforced by `import-boundary.test.ts`):
// This module depends on the runtime contract (`./types.js`) and the
//     shell-owned root marker only. It imports NO concrete editor runtime.
// The registry NEVER interprets runtime positions, maps click coordinates,
//     or dispatches edit commands. Event-target resolution selects a runtime; it
//     does nothing editor-semantic.
// `SuperDoc.activeEditor` has exactly one writer. The chosen path :
//     `setActiveEditor(...)` remains the sole writer of `SuperDoc.activeEditor`.
//     The registry only OBSERVES active changes and surfaces the next runtime's
//     legacy editor projection on the active-change event; SuperDoc routes that
//     projection through `setActiveEditor(...)` so compatibility side effects
//     are preserved. The registry never assigns
//     `activeEditor` itself.

import type { EditorRuntime, EditorRuntimeId } from './types.js';
import { RUNTIME_ROOT_ATTRIBUTE } from './root-marker.js';

/**
 * Payload emitted whenever the active runtime changes (including when the active
 * runtime is unregistered and active state clears).
 */
export interface EditorRuntimeRegistryActiveChange {
  /** Runtime id that was active before this change, or `null`. */
  readonly previousRuntimeId: EditorRuntimeId | null;
  /** Runtime id that is active after this change, or `null` when cleared. */
  readonly nextRuntimeId: EditorRuntimeId | null;
  /** Stable reason string describing why the active runtime changed. */
  readonly reason: string;
  /**
   * The next active runtime's compatibility projection, if it exposes one. This
   * is the value SuperDoc routes through `setActiveEditor(...)` to keep the
   * `activeEditor` compatibility surface populated. `null` when the active
   * runtime was cleared or the runtime has no legacy projection.
   */
  readonly legacyEditorProjection: unknown | null;
}

type EditorRuntimeRegistryListener = (change: EditorRuntimeRegistryActiveChange) => void;
export type EditorRuntimeRegistryUnsubscribe = () => void;

/**
 * Internal SuperDoc registry of mounted editor runtimes and the active-runtime
 * routing policy. Not a public SDK surface.
 */
export class EditorRuntimeRegistry {
  /** Runtimes keyed by their unique id, in insertion order. */
  readonly #runtimes = new Map<EditorRuntimeId, EditorRuntime>();
  /** Reverse index from host root element to runtime id (duplicate-root guard). */
  readonly #rootToId = new Map<HTMLElement, EditorRuntimeId>();
  /** The currently active runtime id, or `null` when no runtime is active. */
  #activeId: EditorRuntimeId | null = null;
  /** Active-change subscribers. */
  readonly #listeners = new Set<EditorRuntimeRegistryListener>();

  /**
   * Register a mounted runtime.
   *
   * Does NOT auto-activate the runtime  -  activation is always an explicit
   * `setActive(...)` decision so cleanup never silently retargets commands.
   *
   * @param runtime The runtime to register.
   * @throws If a runtime with the same id is already registered, or a different
   *   runtime is already registered against the same root element.
   */
  register(runtime: EditorRuntime): void {
    if (this.#runtimes.has(runtime.id)) {
      throw new Error(`EditorRuntimeRegistry: duplicate runtime id "${runtime.id}"`);
    }
    const root = runtime.root;
    const existingForRoot = root ? this.#rootToId.get(root) : undefined;
    if (existingForRoot !== undefined && existingForRoot !== runtime.id) {
      throw new Error(`EditorRuntimeRegistry: root element already registered to runtime "${existingForRoot}"`);
    }
    this.#runtimes.set(runtime.id, runtime);
    if (root) this.#rootToId.set(root, runtime.id);
  }

  /**
   * Unregister a runtime by id.
   *
   * If the unregistered runtime is the active one, active state is CLEARED and an
   * active-change event with `nextRuntimeId: null` is emitted. The registry must
   * NOT auto-promote another runtime to active  -  that would silently retarget
   * commands to a different document (the runtime contract, exit criteria §7).
   *
   * @param runtimeId The runtime id to remove.
   * @returns `true` when a runtime was removed, `false` when none matched.
   */
  unregister(runtimeId: EditorRuntimeId): boolean {
    const runtime = this.#runtimes.get(runtimeId);
    if (!runtime) return false;

    this.#runtimes.delete(runtimeId);
    if (runtime.root) this.#rootToId.delete(runtime.root);

    if (this.#activeId === runtimeId) {
      this.#activeId = null;
      this.#emit({
        previousRuntimeId: runtimeId,
        nextRuntimeId: null,
        reason: 'active-runtime-unregistered',
        legacyEditorProjection: null,
      });
    }
    return true;
  }

  /**
   * Get a registered runtime by id.
   *
   * @param runtimeId The runtime id.
   * @returns The runtime, or `null` when not registered.
   */
  get(runtimeId: EditorRuntimeId): EditorRuntime | null {
    return this.#runtimes.get(runtimeId) ?? null;
  }

  /**
   * All registered runtimes, in registration order.
   */
  getAll(): EditorRuntime[] {
    return Array.from(this.#runtimes.values());
  }

  /**
   * All registered runtimes for a document id, in registration order.
   *
   * Returns every match rather than silently picking the first, because two
   * runtimes can legitimately back the same document.
   *
   * @param documentId The document id to match.
   * @returns The matching runtimes (possibly empty).
   */
  getAllByDocumentId(documentId: string): EditorRuntime[] {
    const matches: EditorRuntime[] = [];
    for (const runtime of this.#runtimes.values()) {
      if (runtime.documentId === documentId) matches.push(runtime);
    }
    return matches;
  }

  /**
   * The currently active runtime, or `null` when none is active.
   */
  getActive(): EditorRuntime | null {
    if (this.#activeId === null) return null;
    return this.#runtimes.get(this.#activeId)!;
  }

  /**
   * The currently active runtime id, or `null`.
   */
  getActiveId(): EditorRuntimeId | null {
    return this.#activeId;
  }

  /**
   * Select the active runtime (or clear it with `null`).
   *
   * Idempotent: selecting the already-active runtime is a no-op and emits
   * nothing, so it does not trigger a redundant toolbar rebind.
   *
   * @param runtimeId The runtime id to activate, or `null` to clear active state.
   * @param reason Stable reason string for the active-change event.
   * @throws If `runtimeId` is non-null and not registered.
   */
  setActive(runtimeId: EditorRuntimeId | null, reason: string): void {
    if (runtimeId !== null && !this.#runtimes.has(runtimeId)) {
      throw new Error(`EditorRuntimeRegistry: cannot activate unknown runtime "${runtimeId}"`);
    }
    if (runtimeId === this.#activeId) return;

    const previousRuntimeId = this.#activeId;
    this.#activeId = runtimeId;

    let legacyEditorProjection: unknown | null = null;
    if (runtimeId !== null) {
      const runtime = this.#runtimes.get(runtimeId)!;
      legacyEditorProjection = runtime.getLegacyEditorProjection?.() ?? null;
    }

    this.#emit({ previousRuntimeId, nextRuntimeId: runtimeId, reason, legacyEditorProjection });
  }

  /**
   * Resolve the runtime that owns a DOM event target by walking up to the
   * nearest element carrying the shell-owned root marker.
   *
   * This selects a runtime only; it performs no coordinate-to-position mapping
   * and no command dispatch.
   *
   * @param target An event target (typically `event.target`), node, or `null`.
   * @returns The owning runtime, or `null` when no marked root is found or the
   *   marked id is not registered.
   */
  resolveFromEventTarget(target: EventTarget | null): EditorRuntime | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    if (!element) return null;
    const host = element.closest(`[${RUNTIME_ROOT_ATTRIBUTE}]`);
    if (!host) return null;
    const id = host.getAttribute(RUNTIME_ROOT_ATTRIBUTE);
    const runtime = id ? this.get(id) : null;
    if (!runtime) return null;
    return runtime.root === host ? runtime : null;
  }

  /**
   * Subscribe to active-runtime changes.
   *
   * @param listener Called with each {@link EditorRuntimeRegistryActiveChange}.
   * @returns An unsubscribe function.
   */
  subscribe(listener: EditorRuntimeRegistryListener): EditorRuntimeRegistryUnsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Tear down the registry: drop all runtimes, root index, active state, and
   * subscriptions. Used during SuperDoc destroy / document teardown. Does not
   * emit  -  subscribers are being released alongside the registry.
   */
  clear(): void {
    this.#runtimes.clear();
    this.#rootToId.clear();
    this.#activeId = null;
    this.#listeners.clear();
  }

  #emit(change: EditorRuntimeRegistryActiveChange): void {
    for (const listener of Array.from(this.#listeners)) {
      try {
        listener(change);
      } catch {
        /* a subscriber error must not break active routing */
      }
    }
  }
}
