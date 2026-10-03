import type {
  InteractionHistoryEvent,
  InteractionHistorySnapshot,
  SuperDocDiagnostics,
} from '../../core/types/diagnostics.js';
import { WorkflowRecorder, type WorkflowRecording } from './workflow-recording.js';

export interface InternalDiagnostics extends SuperDocDiagnostics {
  readonly recording?: WorkflowRecording;
}

export function isWorkflowRecordingEnabled(config: unknown): boolean {
  try {
    return own(own(own(config, 'diagnostics'), 'recording'), 'enabled') === true;
  } catch {
    return false;
  }
}

const recorders = new WeakMap<object, InteractionRecorder>();
let nextSession = 0;
const fields = [
  'documentId',
  'generation',
  'actionId',
  'commandId',
  'operation',
  'source',
  'origin',
  'outcome',
  'phase',
  'success',
  'changed',
  'dryRun',
  'revision',
  'txId',
  'direction',
  'inputType',
  'inputKind',
  'editableCommandKind',
  'dataLength',
  'isComposing',
  'hasRangeSelection',
  'durationMs',
  'elapsedMs',
  'code',
  'reason',
  'failureSource',
  'diagnosticCode',
  'diagnosticStage',
  'internalCode',
  'severity',
  'status',
  'state',
  'beforeHello',
  'remoteGeneration',
  'changedStoryIds',
  'changedPartUris',
  'reviewChanged',
  'saveId',
  'byteLength',
  'targetCommitSequence',
  'paintedCommitSequence',
  'paintedRenderInputEpoch',
  'health',
  'commitSequence',
  'documentEpoch',
  'renderInputEpoch',
  'layoutEpoch',
  'renderEpoch',
  'hasCommitEvent',
  'input',
  'receipt',
  'result',
  'failure',
  'selection',
  'target',
  'selectionTarget',
  'start',
  'end',
  'from',
  'to',
  'offset',
  'blockId',
  'nodeId',
  'kind',
  'story',
  'storyType',
  'id',
  'empty',
  'activeMarks',
  'affectedStories',
  'inserted',
  'updated',
  'removed',
  'invalidatedRefs',
  'remappedRefs',
  'textRangeShifts',
  'insertedLength',
  'deletedLength',
  'renderCommit',
  'snapshot',
  'lifecycle',
  'workerFailure',
  'timing',
  'selectionBefore',
  'selectionAfter',
] as const;
const contentFields = ['text', 'data', 'message', 'errorMessage', 'quotedText', 'value'] as const;

function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  // Do not execute customer getters/toJSON while observing an operation.
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
function limit(value: unknown, fallback: number, ceiling: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= ceiling ? value : fallback;
}

class InteractionRecorder {
  readonly workflow: WorkflowRecorder | undefined;
  readonly sessionId = `interaction-${++nextSession}`;
  readonly maxEvents: number;
  readonly maxBytes: number;
  readonly captureContent: boolean;
  readonly enabled: boolean;
  private slots: Array<string | undefined> = [];
  private head = 0;
  private count = 0;
  private sequence = 0;
  private actions = 0;
  private bytes = 0;
  private evicted = 0;
  private truncated = 0;
  private failures = 0;
  private closed = false;
  private lastSelection: string | undefined;
  private cleanups: Array<() => void> = [];

  constructor(
    config: unknown,
    private readonly version: () => string,
    root: HTMLElement,
  ) {
    if (isWorkflowRecordingEnabled(config)) {
      try {
        this.workflow = new WorkflowRecorder(root, version);
      } catch {
        /* Recording setup must not disable rolling history. */
      }
    }
    const history = own(own(config, 'diagnostics'), 'history');
    this.enabled = own(history, 'enabled') !== false;
    this.captureContent = own(history, 'captureContent') === true;
    this.maxEvents = limit(own(history, 'maxEvents'), 500, 10_000);
    this.maxBytes = limit(own(history, 'maxBytes'), 1_048_576, 16_777_216);
  }

  record(type: string, read: () => unknown): void {
    this.workflow?.observe(type, read);
    if (!this.enabled || this.closed) return;
    try {
      let truncated = false;
      let remaining = 128;
      const project = (value: unknown, depth = 0): unknown => {
        if (--remaining < 0 || depth > 5) {
          truncated = true;
          return undefined;
        }
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
        if (typeof value === 'string') {
          if (value.length > 512) truncated = true;
          return value.slice(0, 512);
        }
        if (!value || typeof value !== 'object') return undefined;
        if (Array.isArray(value)) {
          const length = Math.min(value.length, 16);
          if (value.length > length) truncated = true;
          const result: unknown[] = [];
          for (let i = 0; i < length && remaining > 0; i++)
            result.push(project(own(value, String(i)), depth + 1) ?? null);
          return result;
        }
        const result: Record<string, unknown> = {};
        for (const key of this.captureContent ? [...fields, ...contentFields] : fields) {
          if (remaining <= 0) {
            truncated = true;
            break;
          }
          const item = own(value, key);
          if (item === undefined) continue;
          const copied = project(item, depth + 1);
          if (copied !== undefined) result[key] = copied;
        }
        return result;
      };
      const data = (project(read()) ?? {}) as Record<string, unknown>;
      if (type === 'selection:changed') {
        const selection = JSON.stringify(data);
        if (selection === this.lastSelection) return;
        this.lastSelection = selection;
      } else this.lastSelection = undefined;
      const event: InteractionHistoryEvent = {
        sequence: ++this.sequence,
        observedAt: Date.now(),
        type,
        data,
        truncated,
      };
      let serialized = JSON.stringify(event);
      // One large receipt must not allocate or evict an entire session's history.
      if (serialized.length * 2 > Math.min(8192, this.maxBytes)) {
        event.data = {};
        event.truncated = true;
        serialized = JSON.stringify(event);
      }
      if (event.truncated) this.truncated++;
      if (serialized.length * 2 > this.maxBytes) {
        this.evicted++;
        return;
      }
      while (this.count && (this.count >= this.maxEvents || this.bytes + serialized.length * 2 > this.maxBytes)) {
        const old = this.slots[this.head]!;
        this.bytes -= old.length * 2;
        this.slots[this.head] = undefined;
        this.head = (this.head + 1) % this.maxEvents;
        this.count--;
        this.evicted++;
      }
      this.slots[(this.head + this.count) % this.maxEvents] = serialized;
      this.count++;
      this.bytes += serialized.length * 2;
    } catch {
      this.failures++;
    }
  }

  action(): string | undefined {
    return (this.enabled || this.workflow?.active) && !this.closed ? `${this.sessionId}:${++this.actions}` : undefined;
  }

  snapshot(): InteractionHistorySnapshot {
    const events: InteractionHistoryEvent[] = [];
    try {
      for (let i = 0; i < this.count; i++) events.push(JSON.parse(this.slots[(this.head + i) % this.maxEvents]!));
    } catch {
      this.failures++;
    }
    let version = 'unknown';
    try {
      version = this.version();
    } catch {
      this.failures++;
    }
    return {
      schemaVersion: 1,
      sessionId: this.sessionId,
      version,
      enabled: this.enabled,
      events,
      retainedBytes: this.bytes,
      evictedEvents: this.evicted,
      truncatedEvents: this.truncated,
      captureFailures: this.failures,
    };
  }

  clear(): void {
    this.slots = [];
    this.head = 0;
    this.count = 0;
    this.bytes = 0;
    this.evicted = 0;
    this.truncated = 0;
    this.failures = 0;
    this.lastSelection = undefined;
  }

  attach(root: HTMLElement): void {
    if (!this.enabled) return;
    for (const type of ['keydown', 'beforeinput', 'compositionstart', 'compositionend', 'paste', 'cut', 'drop']) {
      const listener = (event: Event) =>
        this.record(`input:${type}`, () => {
          const input = event as InputEvent;
          if (event.type === 'keydown') {
            const keyboard = event as KeyboardEvent;
            const named = [
              'Backspace',
              'Delete',
              'Enter',
              'Tab',
              'Escape',
              'ArrowLeft',
              'ArrowRight',
              'ArrowUp',
              'ArrowDown',
            ];
            return {
              inputKind: named.includes(keyboard.key) ? keyboard.key : 'key',
              dataLength: keyboard.key.length === 1 ? 1 : undefined,
              isComposing: keyboard.isComposing,
            };
          }
          // Only read text already carried by the event; never fetch clipboard or DOM content.
          return {
            inputType: input.inputType,
            dataLength: input.data?.length,
            isComposing: input.isComposing,
            ...(this.captureContent ? { data: input.data } : {}),
          };
        });
      try {
        root.addEventListener(type, listener, true);
        this.cleanups.push(() => root.removeEventListener(type, listener, true));
      } catch {
        this.failures++;
      }
    }
  }

  close(): void {
    this.workflow?.close();
    this.closed = true;
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch {
        this.failures++;
      }
    }
    this.cleanups = [];
  }
}

const unavailableSnapshot = (): InteractionHistorySnapshot => ({
  schemaVersion: 1,
  sessionId: 'unavailable',
  version: 'unknown',
  enabled: false,
  events: [],
  retainedBytes: 0,
  evictedEvents: 0,
  truncatedEvents: 0,
  captureFailures: 1,
});
const unavailable: InternalDiagnostics = Object.freeze({ getSnapshot: unavailableSnapshot, clear() {} });

export function createInteractionHistory(
  owner: object,
  config: unknown,
  version: () => string,
  root: HTMLElement,
): InternalDiagnostics {
  try {
    const recorder = new InteractionRecorder(config, version, root);
    recorders.set(owner, recorder);
    recorder.attach(root);
    const handle: InternalDiagnostics = Object.freeze({
      ...(recorder.workflow ? { recording: recorder.workflow.api } : {}),
      getSnapshot: () => {
        try {
          return recorder.snapshot();
        } catch {
          return unavailableSnapshot();
        }
      },
      clear: () => {
        try {
          recorder.clear();
        } catch {
          /* Optional capture cannot interrupt the host. */
        }
      },
    });
    recorder.record('instance:created', () => ({}));
    return handle;
  } catch {
    return unavailable;
  }
}

/** Every producer crosses this guard before reading or retaining diagnostic data. */
export function recordInteraction(owner: object | null | undefined, type: string, read: () => unknown): void {
  try {
    if (owner) recorders.get(owner)?.record(type, read);
  } catch {
    /* Never forward recorder failures to onException. */
  }
}
export function beginInteraction(owner: object, type: string, read: () => Record<string, unknown>): string | undefined {
  try {
    const recorder = recorders.get(owner);
    const actionId = recorder?.action();
    if (actionId) recorder?.record(type, () => ({ ...read(), actionId }));
    return actionId;
  } catch {
    return undefined;
  }
}
export function closeInteractionHistory(owner: object): void {
  try {
    recorders.get(owner)?.close();
    recorders.delete(owner);
  } catch {
    /* Teardown must continue. */
  }
}

export function getWorkflowRecording(owner: object): WorkflowRecording | undefined {
  return recorders.get(owner)?.workflow?.api;
}
