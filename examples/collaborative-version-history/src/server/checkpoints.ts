import type { CheckpointTrigger } from './version-store.ts';

export interface CheckpointPolicy {
  idleMs: number | null;
  maxIntervalMs: number | null;
  whenLastEditorLeaves: boolean;
}

export interface CheckpointSchedulerOptions {
  policy: CheckpointPolicy;
  checkpoint(documentId: string, trigger: CheckpointTrigger): Promise<unknown>;
  log?: (message: string) => void;
}

export interface CheckpointScheduler {
  roomChanged(documentId: string): void;
  roomEmptied(documentId: string): void;
  changeCount(documentId: string): number;
  checkpointed(documentId: string, changesInSnapshot: number): void;
  pending(): string[];
  stop(): Promise<void>;
}

const AUTOMATIC_LABELS: Partial<Record<CheckpointTrigger, string>> = {
  idle: 'Autosave after a pause',
  interval: 'Autosave during continuous editing',
  'last-editor-left': 'Autosave when the last editor left',
  shutdown: 'Autosave before the server stopped',
};

export const automaticLabel = (trigger: CheckpointTrigger) => AUTOMATIC_LABELS[trigger] ?? trigger;

export function createCheckpointScheduler(options: CheckpointSchedulerOptions): CheckpointScheduler {
  const { policy } = options;
  const log = options.log ?? ((message: string) => console.log(message));
  const dirtySince = new Map<string, number>();
  const changes = new Map<string, number>();
  const idleTimers = new Map<string, NodeJS.Timeout>();
  const intervalTimers = new Map<string, NodeJS.Timeout>();
  const running = new Set<Promise<unknown>>();
  let stopped = false;

  const clearTimers = (documentId: string) => {
    clearTimeout(idleTimers.get(documentId));
    clearTimeout(intervalTimers.get(documentId));
    idleTimers.delete(documentId);
    intervalTimers.delete(documentId);
  };

  const markDirty = (documentId: string) => {
    if (stopped || dirtySince.has(documentId)) return;
    dirtySince.set(documentId, Date.now());
    if (policy.maxIntervalMs !== null) {
      intervalTimers.set(documentId, setTimeout(() => fire(documentId, 'interval'), policy.maxIntervalMs));
    }
  };

  const fire = (documentId: string, trigger: CheckpointTrigger) => {
    if (stopped || !dirtySince.has(documentId)) return;
    clearTimers(documentId);
    dirtySince.delete(documentId);
    const work = options.checkpoint(documentId, trigger).catch((error: unknown) => {
      markDirty(documentId);
      log(`Checkpoint (${trigger}) for ${documentId} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    running.add(work);
    void work.finally(() => running.delete(work));
  };

  return {
    roomChanged(documentId) {
      if (stopped) return;
      changes.set(documentId, (changes.get(documentId) ?? 0) + 1);
      markDirty(documentId);
      if (policy.idleMs !== null) {
        clearTimeout(idleTimers.get(documentId));
        idleTimers.set(documentId, setTimeout(() => fire(documentId, 'idle'), policy.idleMs));
      }
    },
    roomEmptied(documentId) {
      if (policy.whenLastEditorLeaves) fire(documentId, 'last-editor-left');
    },
    changeCount: (documentId) => changes.get(documentId) ?? 0,
    checkpointed(documentId, changesInSnapshot) {
      if ((changes.get(documentId) ?? 0) !== changesInSnapshot) return;
      clearTimers(documentId);
      dirtySince.delete(documentId);
    },
    pending: () => [...dirtySince.keys()],
    async stop() {
      for (const documentId of [...dirtySince.keys()]) fire(documentId, 'shutdown');
      stopped = true;
      for (const documentId of [...idleTimers.keys(), ...intervalTimers.keys()]) clearTimers(documentId);
      await Promise.allSettled(running);
    },
  };
}
