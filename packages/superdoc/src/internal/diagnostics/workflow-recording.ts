export interface WorkflowRecordingOptions {
  /** Opt in to literal keys and input text. Defaults to false. */
  captureContent?: boolean;
  /** Defaults to 20,000; accepted range 1–100,000. */
  maxEvents?: number;
  /** Serialized UTF-16 budget. Defaults to 8 MiB; maximum 64 MiB. */
  maxBytes?: number;
}
export interface WorkflowRecordingEvent {
  sequence: number;
  /** Milliseconds since recording started, on the browser's monotonic clock. */
  atMs: number;
  type: string;
  data: Record<string, unknown>;
}
export interface WorkflowRecordingSnapshot {
  schemaVersion: 1;
  sessionId: string;
  version: string;
  status: 'recording' | 'stopped' | 'incomplete';
  startedAt: number;
  timeOrigin: number;
  startTimeMs: number;
  durationMs: number;
  captureContent: boolean;
  viewport: { width: number; height: number; devicePixelRatio: number };
  events: WorkflowRecordingEvent[];
  retainedBytes: number;
  /** Known unsupported inputs. An empty list does not guarantee replay in a different environment. */
  replayUnsupportedReasons: string[];
  /** Engine work still queued or executing at the end of capture; inputs remain independently recorded. */
  pendingIntentIds: string[];
}
export interface WorkflowRecording {
  readonly active: boolean;
  /** Starts a new session. Throws if a session is active or the instance is destroyed. */
  start(options?: WorkflowRecordingOptions): WorkflowRecordingSnapshot;
  stop(): WorkflowRecordingSnapshot | null;
  /** Detached data; no editor or worker queries. */
  getSnapshot(): WorkflowRecordingSnapshot | null;
}

// This list bounds both capture work and the data crossing the public boundary.
const fields = new Set([
  'documentId',
  'actionId',
  'commandId',
  'operation',
  'source',
  'origin',
  'phase',
  'kind',
  'status',
  'success',
  'changed',
  'reason',
  'code',
  'direction',
  'outcome',
  'receipt',
  'result',
  'failure',
  'rejection',
  'txId',
  'documentEpoch',
  'commitSequence',
  'targetCommitSequence',
  'paintedCommitSequence',
  'renderInputEpoch',
  'paintedRenderInputEpoch',
  'health',
  'selection',
  'selectionBefore',
  'selectionAfter',
  'snapshot',
  'target',
  'start',
  'end',
  'anchor',
  'focus',
  'story',
  'storyType',
  'storyId',
  'refId',
  'noteId',
  'textboxId',
  'position',
  'offset',
  'unit',
  'value',
  'blockId',
  'blockOffset',
  'fragmentId',
  'pageIndex',
  'layoutEpoch',
  'revision',
  'sourceCommit',
  'selectionLineageId',
  'selectionIntentSequence',
  'intentSequence',
  'intentId',
  'authoringMode',
  'editableCommandKind',
  'inputKind',
  'visualIntent',
  'preEdit',
  'postEdit',
  'fallback',
  'selectionRevision',
  'timing',
  'selectionTargetMs',
  'textReplaceMs',
  'postEditSelectionMs',
  'totalMs',
  'inputAtMs',
  'dispatchAtMs',
  'committedAtMs',
  'durationMs',
  'elapsedMs',
  'affectedStories',
  'tableId',
  'cellId',
  'contentControlId',
  'outsideContentControl',
  'trackedBlockOffset',
  'projectionBlockId',
  'geometryBlockId',
  'geometryBlockOffset',
  'geometryTrackedBlockOffset',
  'lineAffinity',
  'inlineAffinity',
  'stability',
  'nativeId',
  'paraId',
  'partId',
  'partRevision',
  'storyRevision',
  'pathFingerprint',
  'path',
  'index',
  'name',
  'id',
  'range',
  'hasRangeSelection',
  'inputType',
  'dataLength',
  'isComposing',
  'repeat',
  'altKey',
  'ctrlKey',
  'metaKey',
  'shiftKey',
  'key',
  'button',
  'buttons',
  'pointerType',
  'clickCount',
  'x',
  'y',
  'selector',
  'domPath',
  'scrollLeft',
  'scrollTop',
  'command',
  'segments',
  'nodeId',
  'byteSpan',
  'sdtId',
  'controlId',
  'scope',
  'coordinateSpace',
  'contentControlIds',
  'scrollAncestors',
  'layoutBlockRef',
  'contextSource',
]);
const contentFields = new Set(['text', 'data', 'message', 'errorMessage', 'quotedText']);
const inputTypes = [
  'keydown',
  'keyup',
  'beforeinput',
  'pointerdown',
  'pointermove',
  'pointerup',
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'scroll',
  'compositionstart',
  'compositionend',
  'paste',
  'cut',
  'drop',
  'dragstart',
];
const namedKeys = new Set([
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Meta',
  'NumLock',
  'ScrollLock',
  'Shift',
  'Enter',
  'Tab',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  'Backspace',
  'Delete',
  'Insert',
  'Escape',
  'ContextMenu',
  'Pause',
  'Dead',
  'Process',
  'Unidentified',
]);
let nextSession = 0;
function own(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}
function budget(value: unknown, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

export class WorkflowRecorder {
  private session: Omit<WorkflowRecordingSnapshot, 'events'> | null = null;
  private events: string[] = [];
  private startMs = 0;
  private maxEvents = 20_000;
  private maxBytes = 8_388_608;
  private closed = false;
  private pendingIntents = new Set<string>();
  private heldKeys = new Set<string>();
  private heldButtons = new Set<number>();
  private cleanups: Array<() => void> = [];
  readonly api: WorkflowRecording;

  constructor(
    private readonly root: HTMLElement,
    private readonly version: () => string,
  ) {
    const recorder = this;
    this.api = Object.freeze({
      get active() {
        return recorder.active;
      },
      start: (options?: WorkflowRecordingOptions) => this.start(options),
      stop: () => this.stop(),
      getSnapshot: () => this.snapshot(),
    });
  }
  private attachInputs(): void {
    const view = this.root.ownerDocument.defaultView;
    if (!view) throw new Error('Workflow recording requires a browser window.');
    // Register before editor handlers that can stop propagation at the mount.
    try {
      for (const type of inputTypes) {
        const listener = (event: Event) => {
          if (!this.active || !event.isTrusted) return;
          try {
            if (event.target instanceof view.Node && this.root.contains(event.target)) this.input(event);
            else {
              const released =
                event.type === 'keyup'
                  ? this.heldKeys.delete((event as KeyboardEvent).key)
                  : event.type === 'pointerup'
                    ? this.heldButtons.delete((event as MouseEvent).button)
                    : false;
              if (released) this.unsupported('input-released-outside-mount');
            }
          } catch {
            this.fail('capture-failure');
          }
        };
        view.addEventListener(type, listener, true);
        this.cleanups.push(() => view.removeEventListener(type, listener, true));
      }
    } catch (error) {
      this.detachInputs();
      throw error;
    }
  }

  private detachInputs(): void {
    const cleanups = this.cleanups;
    this.cleanups = [];
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        /* Continue cleanup without interrupting the editor. */
      }
    }
  }

  get active(): boolean {
    return this.session?.status === 'recording';
  }

  private start(options: WorkflowRecordingOptions = {}): WorkflowRecordingSnapshot {
    if (this.closed) throw new Error('Cannot record a destroyed SuperDoc instance.');
    if (this.active) throw new Error('Stop the active workflow recording first.');
    this.maxEvents = budget(own(options, 'maxEvents'), 20_000, 100_000);
    this.maxBytes = budget(own(options, 'maxBytes'), 8_388_608, 67_108_864);
    const view = this.root.ownerDocument.defaultView!;
    this.events = [];
    this.pendingIntents.clear();
    this.startMs = view.performance.now();
    this.session = {
      schemaVersion: 1,
      sessionId: `workflow-${Date.now()}-${++nextSession}`,
      version: this.version(),
      status: 'recording',
      startedAt: Date.now(),
      durationMs: 0,
      timeOrigin: view.performance.timeOrigin,
      startTimeMs: this.startMs,
      captureContent: own(options, 'captureContent') === true,
      viewport: { width: view.innerWidth, height: view.innerHeight, devicePixelRatio: view.devicePixelRatio },
      retainedBytes: 0,
      replayUnsupportedReasons: [],
      pendingIntentIds: [],
    };
    try {
      this.attachInputs();
      this.observe('workflow:started', () => ({ scrollTop: this.root.scrollTop, scrollLeft: this.root.scrollLeft }));
    } catch {
      this.fail('capture-failure');
    }
    return this.snapshot()!;
  }

  observe(type: string, read: () => unknown): void {
    if (!this.active) return;
    try {
      let remaining = 4096;
      const copy = (value: unknown, depth = 0): unknown => {
        if (--remaining < 0 || depth > 14) throw new Error('payload-limit');
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
        if (typeof value === 'string') {
          if (value.length > 32768) throw new Error('payload-limit');
          return value;
        }
        if (!value || typeof value !== 'object') return undefined;
        if (Array.isArray(value)) {
          if (value.length > 256) throw new Error('payload-limit');
          return Array.from({ length: value.length }, (_, i) => copy(own(value, String(i)), depth + 1) ?? null);
        }
        const result: Record<string, unknown> = {};
        for (const key of fields) {
          const item = own(value, key);
          if (key === 'value' && typeof item === 'string' && !this.session!.captureContent) continue;
          if (item !== undefined) result[key] = copy(item, depth + 1);
        }
        if (this.session!.captureContent)
          for (const key of contentFields) {
            const item = own(value, key);
            if (item !== undefined) result[key] = copy(item, depth + 1);
          }
        return result;
      };
      const event: WorkflowRecordingEvent = {
        sequence: this.events.length + 1,
        atMs: this.root.ownerDocument.defaultView!.performance.now() - this.startMs,
        type,
        data: (copy(read()) ?? {}) as Record<string, unknown>,
      };
      const serialized = JSON.stringify(event);
      if (this.events.length >= this.maxEvents || this.session!.retainedBytes + serialized.length * 2 > this.maxBytes) {
        this.fail('capture-limit');
        return;
      }
      this.events.push(serialized);
      this.session!.retainedBytes += serialized.length * 2;
      if (type === 'interaction:intent') {
        const id = `${event.data.documentId ?? ''}/${event.data.selectionLineageId}/${event.data.intentSequence}`;
        if (event.data.phase === 'enqueued' || event.data.phase === 'executing') this.pendingIntents.add(id);
        if (event.data.phase === 'settled' || event.data.phase === 'failed') this.pendingIntents.delete(id);
      }
    } catch {
      this.fail('capture-failure');
    }
  }

  private unsupported(reason: string): void {
    if (!this.session!.replayUnsupportedReasons.includes(reason)) this.session!.replayUnsupportedReasons.push(reason);
  }
  private fail(reason: string): void {
    if (!this.session) return;
    this.unsupported(reason);
    try {
      this.session.durationMs = this.root.ownerDocument.defaultView!.performance.now() - this.startMs;
    } catch {
      /* Preserve captured events. */
    }
    this.session.status = 'incomplete';
    this.clearHeldInput();
    this.detachInputs();
  }

  private input(event: Event): void {
    if (!this.active || !event.isTrusted) return;
    try {
      const target = event.target instanceof this.root.ownerDocument.defaultView!.Element ? event.target : this.root;
      const pointer = event as PointerEvent;
      if (event.type === 'pointermove' && pointer.buttons === 0) return;
      let element: Element | null = target;
      let selector: string | null = null;
      // Prefer stable document identity; no document text or whole-tree scans.
      while (element && element !== this.root) {
        for (const attribute of [
          'data-layout-fragment-id',
          'data-layout-block-ref',
          'data-page-index',
          'data-item',
          'data-testid',
          'aria-label',
        ]) {
          const value = element.getAttribute(attribute);
          if (value) {
            selector = `[${attribute}=${JSON.stringify(value)}]`;
            break;
          }
        }
        if (selector) break;
        element = element.parentElement;
      }
      if (!selector && target !== this.root) {
        const path: string[] = [];
        element = target;
        while (element && element !== this.root) {
          const parent: Element | null = element.parentElement;
          if (!parent) break;
          path.unshift(`:nth-child(${Array.prototype.indexOf.call(parent.children, element) + 1})`);
          element = parent;
        }
        if (element === this.root) selector = `:scope > ${path.join(' > ')}`;
        element = target;
      }
      const modifiers = event as KeyboardEvent;
      const paintedTarget: Record<string, unknown> = { selector };
      if (event.type.startsWith('pointer') || ['mousedown', 'mouseup', 'click', 'dblclick'].includes(event.type)) {
        const path: string[] = [];
        let part: Element | null = element ?? this.root;
        while (part && part !== this.root) {
          const parent: Element | null = part.parentElement;
          if (!parent) break;
          path.unshift(`:nth-child(${Array.prototype.indexOf.call(parent.children, part) + 1})`);
          part = parent;
        }
        if (part === this.root && path.length) paintedTarget.domPath = `:scope > ${path.join(' > ')}`;
        const controls = new Set<string>();
        for (
          let ancestor: Element | null = target;
          ancestor && ancestor !== this.root;
          ancestor = ancestor.parentElement
        ) {
          for (const [attribute, field] of [
            ['data-source-node-id', 'blockId'],
            ['data-layout-fragment-id', 'fragmentId'],
            ['data-layout-block-ref', 'layoutBlockRef'],
            ['data-layout-story', 'storyId'],
            ['data-page-index', 'pageIndex'],
          ]) {
            const value = ancestor.getAttribute(attribute);
            if (value && paintedTarget[field] == null)
              paintedTarget[field] = field === 'pageIndex' ? Number(value) : value;
          }
          const control = ancestor.getAttribute('data-sdt-id') ?? ancestor.getAttribute('data-sdt-container-id');
          if (control) controls.add(control);
          if (ancestor.classList.contains('superdoc-table-fragment') && paintedTarget.tableId == null) {
            paintedTarget.tableId = ancestor.getAttribute('data-layout-block-ref');
          }
        }
        paintedTarget.contentControlIds = [...controls];
        paintedTarget.contextSource = 'painted-pointer';
        if (paintedTarget.fragmentId && paintedTarget.pageIndex != null) {
          paintedTarget.selector = `[data-page-index="${paintedTarget.pageIndex}"] ${selector}`;
        }
        // Scroll events may arrive after the pointer that caused them. Capture its precondition now.
        const scrollAncestors: Array<{ selector: string | null; scrollLeft: number; scrollTop: number }> = [];
        for (let ancestor: Element | null = target; ancestor; ancestor = ancestor.parentElement) {
          const style = this.root.ownerDocument.defaultView!.getComputedStyle(ancestor);
          const scrollable = ancestor === this.root || /auto|scroll/.test(`${style.overflowX} ${style.overflowY}`);
          if (
            ancestor.scrollLeft ||
            ancestor.scrollTop ||
            (scrollable &&
              (ancestor.scrollWidth > ancestor.clientWidth || ancestor.scrollHeight > ancestor.clientHeight))
          ) {
            const path: string[] = [];
            let part: Element | null = ancestor;
            while (part && part !== this.root) {
              const parent: Element | null = part.parentElement;
              if (!parent) break;
              path.unshift(`:nth-child(${Array.prototype.indexOf.call(parent.children, part) + 1})`);
              part = parent;
            }
            if (part === this.root)
              scrollAncestors.push({
                selector: ancestor === this.root ? null : `:scope > ${path.join(' > ')}`,
                scrollLeft: ancestor.scrollLeft,
                scrollTop: ancestor.scrollTop,
              });
          }
          if (ancestor === this.root) break;
          if (scrollAncestors.length >= 32) throw new Error('scroll-ancestor-limit');
        }
        paintedTarget.scrollAncestors = scrollAncestors;
      }
      const timestamp =
        event.timeStamp > this.root.ownerDocument.defaultView!.performance.timeOrigin
          ? event.timeStamp - this.root.ownerDocument.defaultView!.performance.timeOrigin
          : event.timeStamp;
      const data: Record<string, unknown> = {
        target: paintedTarget,
        inputAtMs: timestamp,
        altKey: modifiers.altKey,
        ctrlKey: modifiers.ctrlKey,
        metaKey: modifiers.metaKey,
        shiftKey: modifiers.shiftKey,
      };
      if (event.type === 'keydown' || event.type === 'keyup') {
        const key = modifiers.key;
        if (event.type === 'keydown') this.heldKeys.add(key);
        else this.heldKeys.delete(key);
        const named = namedKeys.has(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key);
        data.key = !named && !this.session!.captureContent ? undefined : key;
        data.repeat = modifiers.repeat;
        data.isComposing = modifiers.isComposing;
        if (!named && !this.session!.captureContent) this.unsupported('content-redacted');
        if (modifiers.isComposing || key === 'Dead' || key === 'Process') this.unsupported('ime');
      } else if (
        event.type.startsWith('pointer') ||
        ['mousedown', 'mouseup', 'click', 'dblclick'].includes(event.type)
      ) {
        const rect = (element ?? this.root).getBoundingClientRect();
        if (event.type === 'pointerdown') this.heldButtons.add(pointer.button);
        if (event.type === 'pointerup') this.heldButtons.delete(pointer.button);
        Object.assign(data, {
          button: pointer.button,
          buttons: pointer.buttons,
          pointerType: pointer.pointerType ?? 'mouse',
          clickCount: pointer.detail,
          x: pointer.clientX - rect.left,
          y: pointer.clientY - rect.top,
        });
        if (pointer.pointerType && pointer.pointerType !== 'mouse') this.unsupported('non-mouse-pointer');
        if (!selector) this.unsupported('unresolved-pointer-target');
      } else if (event.type === 'scroll') {
        Object.assign(data, { scrollTop: target.scrollTop, scrollLeft: target.scrollLeft });
        if (target !== this.root && !selector) this.unsupported('unresolved-scroll-target');
      } else {
        const input = event as InputEvent;
        Object.assign(data, {
          inputType: input.inputType,
          dataLength: input.data?.length,
          ...(this.session!.captureContent ? { data: input.data } : {}),
        });
        if (input.data && !this.session!.captureContent) this.unsupported('content-redacted');
        if (['paste', 'cut', 'drop', 'dragstart', 'compositionstart', 'compositionend'].includes(event.type))
          this.unsupported(event.type);
        if (event.type === 'beforeinput' && input.inputType !== 'insertText' && !input.inputType?.startsWith('delete'))
          this.unsupported(`beforeinput:${input.inputType}`);
      }
      this.observe(`browser:${event.type}`, () => data);
    } catch {
      this.fail('capture-failure');
    }
  }

  private clearHeldInput(): void {
    this.heldKeys.clear();
    this.heldButtons.clear();
  }
  private stop(): WorkflowRecordingSnapshot | null {
    if (this.active) {
      if (this.heldKeys.size || this.heldButtons.size) this.unsupported('held-input-at-stop');
      this.session!.durationMs = this.root.ownerDocument.defaultView!.performance.now() - this.startMs;
      this.session!.status = 'stopped';
      this.clearHeldInput();
    }
    this.detachInputs();
    return this.snapshot();
  }
  private snapshot(): WorkflowRecordingSnapshot | null {
    if (!this.session) return null;
    return {
      ...this.session,
      viewport: { ...this.session.viewport },
      durationMs: this.active
        ? this.root.ownerDocument.defaultView!.performance.now() - this.startMs
        : this.session.durationMs,
      replayUnsupportedReasons: [...this.session.replayUnsupportedReasons],
      events: this.events.map((event) => JSON.parse(event)),
      pendingIntentIds: [...this.pendingIntents],
    };
  }
  close(): void {
    if (this.active) this.fail('instance-destroyed');
    this.closed = true;
    this.detachInputs();
  }
}
