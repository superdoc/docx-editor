import type {
  EditorRuntime,
  EditorRuntimeCapabilities,
  EditorRuntimeCommand,
  EditorRuntimeCommandKind,
  EditorRuntimeCommandResult,
  EditorRuntimeDocumentMode,
  EditorRuntimeEvent,
  EditorRuntimeExportOptions,
  EditorRuntimeFocusOptions,
  EditorRuntimeId,
  EditorRuntimeLayoutSnapshot,
  EditorRuntimeListener,
  EditorRuntimeNavigationTarget,
  EditorRuntimePositionToken,
  EditorRuntimeRejectionCode,
  EditorRuntimeSelectionSnapshot,
  EditorRuntimeSnapshot,
  EditorRuntimeState,
  EditorRuntimeToolbarState,
  EditorRuntimeUnsubscribe,
} from '../index.js';

import { resolveV2DocxExportOptions } from '../../helpers/resolve-docx-export.js';

type HostLifecycleState = EditorRuntimeState | 'ready';

type HostCommandKind =
  | 'text.insert'
  | 'text.replace'
  | 'text.deleteBackward'
  | 'text.deleteForward'
  | 'text.pastePlain'
  | 'history.undo'
  | 'history.redo'
  | 'structural.enter'
  | 'structural.listIndent'
  | 'structural.listOutdent'
  | string;

interface HostCommandSupportRecordLike {
  readonly command: HostCommandKind | string;
  readonly status: 'supported' | 'unsupported';
  readonly rejectionCode?: string | null;
  readonly reason?: string | null;
  readonly detail?: string | null;
  readonly enabled?: boolean;
}

interface HostSelectionStateLike {
  readonly anchor: unknown;
  readonly focus: unknown;
}

interface HostSelectionControllerLike {
  getSnapshot(): HostSelectionStateLike | null;
  subscribe(listener: (snapshot: HostSelectionStateLike | null) => void): () => void;
}

interface HostHandlesLike {
  readonly editing: {
    readonly selection: HostSelectionControllerLike;
  } | null;
}

interface HostEditableSubsetSnapshotLike {
  readonly editingMounted: boolean;
  readonly commands: readonly HostCommandSupportRecordLike[];
}

interface HostSnapshotLike {
  readonly state: HostLifecycleState;
  readonly documentMode: EditorRuntimeDocumentMode;
  readonly reason?: string;
  readonly detail?: string;
  readonly commentCommandsReason?: 'author-required' | null;
  readonly editableSubset: HostEditableSubsetSnapshotLike;
}

interface HostDispatchRejectionLike {
  readonly code: string;
  readonly detail?: string;
}

type HostDispatchResultLike =
  | { readonly status: 'committed'; readonly receipt?: unknown }
  | { readonly status: 'history-committed'; readonly result?: unknown }
  | { readonly status: 'history-noop'; readonly result?: { readonly reason?: string } }
  | { readonly status: 'receipt-failure'; readonly failure?: unknown }
  | { readonly status: 'rejected'; readonly rejection: HostDispatchRejectionLike };

type MaybePromise<T> = T | Promise<T>;

type HostCommandLike =
  | { readonly kind: 'text.insert'; readonly text: string }
  | { readonly kind: 'text.replace'; readonly text: string }
  | { readonly kind: 'text.deleteBackward' }
  | { readonly kind: 'text.deleteForward' }
  | { readonly kind: 'text.pastePlain'; readonly text: string }
  | { readonly kind: 'history.undo' }
  | { readonly kind: 'history.redo' }
  | { readonly kind: 'structural.enter' }
  | { readonly kind: 'structural.listIndent' }
  | { readonly kind: 'structural.listOutdent' };

interface DocumentFacadeReceiptLike {
  readonly success?: boolean;
  readonly failure?: unknown;
}

interface DocumentFacadeHistoryResultLike {
  readonly noop?: boolean;
  readonly reason?: string;
}

interface DocumentFacadeSelectionInfoLike {
  readonly empty?: boolean;
  readonly target?: unknown;
}

interface DocumentFacadeLike {
  readonly comments?: {
    create?(input: {
      text: string;
      target?: unknown;
      parentCommentId?: string;
    }): MaybePromise<DocumentFacadeReceiptLike>;
    patch?(input: {
      commentId: string;
      text?: string;
      status?: 'resolved' | 'active';
    }): MaybePromise<DocumentFacadeReceiptLike>;
    delete?(input: { commentId: string }): MaybePromise<DocumentFacadeReceiptLike>;
  };
  readonly trackChanges?: {
    decide?(input: {
      decision: 'accept' | 'reject';
      target: { kind: 'id'; id: string } | { kind: 'all' };
    }): MaybePromise<DocumentFacadeReceiptLike>;
  };
  readonly history?: {
    undo?(): MaybePromise<DocumentFacadeHistoryResultLike>;
    redo?(): MaybePromise<DocumentFacadeHistoryResultLike>;
  };
  readonly selection?: {
    current?(input?: { includeText?: boolean }): MaybePromise<DocumentFacadeSelectionInfoLike>;
  };
}

type DocumentFacadeResultLike =
  | { readonly available: true; readonly doc: DocumentFacadeLike }
  | { readonly available: false; readonly reason?: string };

interface HostPageMetricsSnapshotLike {
  readonly pages: readonly unknown[];
  readonly zoom: {
    readonly percent: number;
  };
}

interface HostSetZoomResultLike {
  readonly status: 'ok' | 'rejected';
  readonly reason?: string;
}

interface HostFocusHandleLike {
  focus?(options?: unknown): boolean | void | Promise<boolean | void>;
}

interface HostMountHandleLike {
  readonly focus: HostFocusHandleLike | null;
}

interface ModeAwareHostLike {
  getSnapshot(): HostSnapshotLike;
  subscribe(listener: (snapshot: HostSnapshotLike) => void): () => void;
  getDocumentMode(): EditorRuntimeDocumentMode;
  setDocumentMode(mode: EditorRuntimeDocumentMode): void;
  setTrackedChangesRenderOptions(options?: { mode?: 'review' | 'original' | 'final' | 'off'; enabled?: boolean }): void;
  setShowFormattingMarks(show: boolean): void;
  dispatch(command: HostCommandLike): Promise<HostDispatchResultLike>;
  save(options?: { format?: 'docx' } & ReturnType<typeof resolveV2DocxExportOptions>): Promise<ArrayBuffer>;
  dispose(): Promise<void>;
  getHandles(): HostHandlesLike;
  getDocumentFacade?(): DocumentFacadeResultLike;
  getPageMetricsSnapshot(): HostPageMetricsSnapshotLike;
  subscribePageMetrics?(listener: (snapshot: HostPageMetricsSnapshotLike) => void): () => void;
  setZoom(percent: number): HostSetZoomResultLike;
}

export interface V2EditorRuntimeAdapterOptions {
  readonly id: EditorRuntimeId;
  readonly documentId: string;
  readonly root: HTMLElement;
  readonly host: ModeAwareHostLike;
  readonly getLegacyEditorProjection?: () => unknown;
  readonly onUnregister?: (id: EditorRuntimeId) => void;
}

const DEFAULT_V2_LEGACY_PROJECTION = Object.freeze({
  editorVersion: 2,
  commands: null,
  state: null,
  view: null,
});

const TEXT_AND_STRUCTURE_COMMANDS: readonly EditorRuntimeCommandKind[] = [
  'text.insert',
  'text.replace',
  'text.deleteBackward',
  'text.deleteForward',
  'text.paste',
  'history.undo',
  'history.redo',
  'structural.splitBlock',
  'structural.indent',
  'structural.outdent',
];

const REVIEW_COMMANDS: readonly EditorRuntimeCommandKind[] = [
  'comments.create',
  'comments.resolve',
  'comments.reopen',
  'comments.delete',
  'comments.reply',
  'comments.edit',
  'trackedChanges.accept',
  'trackedChanges.reject',
  'trackedChanges.acceptAll',
  'trackedChanges.rejectAll',
];

const ALWAYS_SUPPORTED_COMMANDS: readonly EditorRuntimeCommandKind[] = ['trackedChanges.setAuthoringMode'];

function normalizeLifecycleState(snapshot: HostSnapshotLike): EditorRuntimeState {
  if (snapshot.state !== 'ready') return snapshot.state;
  return snapshot.documentMode === 'viewing' ? 'review-ready' : 'editing-ready';
}

function isReadyLifecycleState(state: EditorRuntimeState): boolean {
  return state === 'review-ready' || state === 'editing-ready';
}

function commandKindForSupport(kind: EditorRuntimeCommandKind): HostCommandKind | null {
  switch (kind) {
    case 'text.insert':
      return 'text.insert';
    case 'text.replace':
      return 'text.replace';
    case 'text.deleteBackward':
      return 'text.deleteBackward';
    case 'text.deleteForward':
      return 'text.deleteForward';
    case 'text.paste':
      return 'text.pastePlain';
    case 'history.undo':
      return 'history.undo';
    case 'history.redo':
      return 'history.redo';
    case 'structural.splitBlock':
      return 'structural.enter';
    case 'structural.indent':
      return 'structural.listIndent';
    case 'structural.outdent':
      return 'structural.listOutdent';
    default:
      return null;
  }
}

function reviewCommandKindForSupport(kind: EditorRuntimeCommandKind): string | null {
  switch (kind) {
    case 'comments.create':
      return 'comments.createFromSelection';
    case 'comments.resolve':
      return 'review.commentResolve';
    case 'comments.reopen':
      return 'review.commentReopen';
    case 'comments.delete':
      return 'review.commentDelete';
    case 'comments.reply':
      return 'review.commentReply';
    case 'comments.edit':
      return 'review.commentEdit';
    case 'trackedChanges.accept':
    case 'trackedChanges.reject':
      return 'review.trackedChangeDecide';
    case 'trackedChanges.acceptAll':
      return 'trackedChanges.acceptAll';
    case 'trackedChanges.rejectAll':
      return 'trackedChanges.rejectAll';
    default:
      return null;
  }
}

function supportRecordFor(current: HostSnapshotLike, command: string): HostCommandSupportRecordLike | null {
  return current.editableSubset.commands.find((entry) => entry.command === command) ?? null;
}

function supportRecordIsSupported(record: HostCommandSupportRecordLike | null): boolean {
  return record?.status === 'supported' || record?.enabled === true;
}

function supportRecordRejectionCode(record: HostCommandSupportRecordLike | null): string | null {
  return record?.rejectionCode ?? record?.reason ?? null;
}

function supportRecordDetail(record: HostCommandSupportRecordLike | null): string | undefined {
  return record?.detail ?? undefined;
}

function isHostCommandSupported(current: HostSnapshotLike, command: string): boolean {
  return supportRecordIsSupported(supportRecordFor(current, command));
}

function unsupportedRuntimeRejection(
  current: HostSnapshotLike,
  command: string,
): { reason: EditorRuntimeRejectionCode; detail?: string } {
  const record = supportRecordFor(current, command);
  const rawCode = supportRecordRejectionCode(record);
  if (rawCode) return { reason: rejectionCode(rawCode), detail: supportRecordDetail(record) };
  if (current.documentMode === 'viewing') return { reason: 'document-readonly', detail: 'review-surface-read-only' };
  return { reason: 'command-unsupported', detail: `unsupported:${command}` };
}

function historyNoopReason(
  kind: EditorRuntimeCommand['kind'],
  result: unknown,
): 'nothing-to-undo' | 'nothing-to-redo' | 'no-effect' {
  const rawReason = (result as { reason?: string } | null | undefined)?.reason;
  if (kind === 'history.undo') {
    return rawReason === 'NO_EFFECT' || rawReason === 'apply-rejected' ? 'no-effect' : 'nothing-to-undo';
  }
  return rawReason === 'NO_EFFECT' || rawReason === 'apply-rejected' ? 'no-effect' : 'nothing-to-redo';
}

function rejectionCode(code: string): EditorRuntimeRejectionCode {
  switch (code) {
    case 'host-saving':
      return 'host-saving';
    case 'document-readonly':
      return 'document-readonly';
    case 'selection-invalidated':
    case 'review-target-invalidated':
      return 'selection-invalidated';
    case 'review-command-unavailable':
      return 'review-command-unavailable';
    case 'review-surface-read-only':
      return 'document-readonly';
    case 'editing-selection-required':
      return 'selection-unsupported';
    case 'format-target-unsupported':
    case 'selection-target-unsupported':
    case 'input-target-unsupported':
    case 'composition-target-unsupported':
    case 'enter-context-unsupported':
    case 'boundary-merge-unsupported':
    case 'tracked-structural-edit-unsupported':
    case 'comment-anchor-create-unsupported':
    case 'comment-anchor-move-unsupported':
      return 'target-unsupported';
    case 'unsupported-command':
      return 'command-unsupported';
    case 'editing-mount-required':
    case 'host-not-ready':
    case 'host-disposed':
      return 'runtime-not-ready';
    default:
      return 'command-failed';
  }
}

export function createV2EditorRuntimeAdapter(options: V2EditorRuntimeAdapterOptions): {
  runtime: EditorRuntime;
  attachMountHandle(handle: HostMountHandleLike | null): void;
} {
  const { id, documentId, root, host, getLegacyEditorProjection, onUnregister } = options;

  let snapshot = host.getSnapshot();
  let didDispose = false;
  let unregistered = false;
  let mountedFocusHandle: HostMountHandleLike | null = null;
  let tokenRevision = 0;
  let tokenSeq = 0;
  let selectionUnsubscribe: (() => void) | null = null;
  let hostUnsubscribe: (() => void) | null = null;
  let pageMetricsUnsubscribe: (() => void) | null = null;
  let activeSelectionController: HostSelectionControllerLike | null = null;
  const positionTokens = new Map<string, unknown>();
  const listeners = new Set<EditorRuntimeListener>();

  function emit(event: EditorRuntimeEvent): void {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch {
        /* listener errors must not break the runtime */
      }
    }
  }

  function invalidatePositionTokens(): void {
    tokenRevision += 1;
    positionTokens.clear();
  }

  function mintToken(marker: unknown): EditorRuntimePositionToken {
    const tokenId = `v2-runtime-pos-${tokenSeq++}`;
    positionTokens.set(tokenId, marker);
    return { runtimeId: id, tokenId, revision: tokenRevision };
  }

  function resolveToken(
    token: EditorRuntimePositionToken,
  ): { ok: true } | { ok: false; reason: 'wrong-runtime-token' | 'stale-position-token' } {
    if (token.runtimeId !== id) return { ok: false, reason: 'wrong-runtime-token' };
    if (token.revision !== tokenRevision || !positionTokens.has(token.tokenId)) {
      return { ok: false, reason: 'stale-position-token' };
    }
    return { ok: true };
  }

  function selectionController(): HostSelectionControllerLike | null {
    return host.getHandles().editing?.selection ?? null;
  }

  function selectionSnapshot(): EditorRuntimeSelectionSnapshot | null {
    const current = selectionController()?.getSnapshot() ?? null;
    if (!current) return null;
    return {
      isRange: current.anchor !== current.focus,
      isEmpty: current.anchor === current.focus,
      text: '',
      anchor: mintToken(current.anchor),
      focus: mintToken(current.focus),
    };
  }

  function syncSelectionSubscription(): void {
    const next = selectionController();
    if (next === activeSelectionController) return;
    selectionUnsubscribe?.();
    selectionUnsubscribe = null;
    activeSelectionController = next;
    if (!next) return;
    selectionUnsubscribe = next.subscribe((current) => {
      invalidatePositionTokens();
      const mapped = current
        ? {
            isRange: current.anchor !== current.focus,
            isEmpty: current.anchor === current.focus,
            text: '',
            anchor: mintToken(current.anchor),
            focus: mintToken(current.focus),
          }
        : {
            isRange: false,
            isEmpty: true,
            text: '',
          };
      emit({ type: 'selection-change', selection: mapped });
    });
  }

  function getDocumentFacade(): DocumentFacadeLike | null {
    const result = host.getDocumentFacade?.() ?? null;
    return result?.available === true ? result.doc : null;
  }

  function hasDocumentReviewFacade(): boolean {
    const doc = getDocumentFacade();
    return Boolean(doc?.comments && doc.trackChanges);
  }

  function supportedCommands(current: HostSnapshotLike): readonly EditorRuntimeCommandKind[] {
    if (!isReadyLifecycleState(normalizeLifecycleState(current))) return [];
    const runtimeKinds = TEXT_AND_STRUCTURE_COMMANDS.filter((kind) => {
      const mapped = commandKindForSupport(kind);
      return mapped !== null && isHostCommandSupported(current, mapped);
    });
    const reviewKinds = hasDocumentReviewFacade()
      ? REVIEW_COMMANDS.filter((kind) => {
          const mapped = reviewCommandKindForSupport(kind);
          return mapped !== null && isHostCommandSupported(current, mapped);
        })
      : [];
    return [...runtimeKinds, ...reviewKinds, ...ALWAYS_SUPPORTED_COMMANDS];
  }

  function capabilities(current: HostSnapshotLike = snapshot): EditorRuntimeCapabilities {
    const lifecycleState = normalizeLifecycleState(current);
    const canFocus = lifecycleState !== 'disposed';
    const availableCommands = supportedCommands(current);
    return {
      lifecycle: { canFocus, canDispose: true },
      selection: {
        canReadSelectedText: true,
        canReadSelectionSnapshot: true,
        canMintPositionTokens: true,
      },
      commands: {
        canDispatch: isReadyLifecycleState(lifecycleState) && availableCommands.length > 0,
        supportedCommands: availableCommands,
      },
      layout: { supported: true, hasSyncSnapshot: true },
      zoom: { supported: true, min: 25, max: 400 },
      navigation: { supported: false, targets: [] },
      persistence: { canSave: true, canExportDocx: true },
      comments: {
        supported: true,
        canMutate:
          current.commentCommandsReason !== 'author-required' &&
          [
            'comments.create',
            'comments.resolve',
            'comments.reopen',
            'comments.delete',
            'comments.reply',
            'comments.edit',
          ].some((kind) => availableCommands.includes(kind as EditorRuntimeCommandKind)),
      },
      trackedChanges: {
        supported: true,
        canDecide:
          availableCommands.includes('trackedChanges.accept') || availableCommands.includes('trackedChanges.reject'),
        canToggleAuthoring: isReadyLifecycleState(lifecycleState),
      },
    };
  }

  function currentLayoutSnapshot(): EditorRuntimeLayoutSnapshot {
    const pageMetrics = host.getPageMetricsSnapshot();
    return {
      pageCount: pageMetrics.pages.length,
      currentPage: 1,
      zoom: pageMetrics.zoom.percent,
    };
  }

  function runtimeSnapshot(current: HostSnapshotLike = snapshot): EditorRuntimeSnapshot {
    return {
      id,
      kind: 'v2',
      documentId,
      state: normalizeLifecycleState(current),
      documentMode: current.documentMode,
      reason: current.reason,
      capabilities: capabilities(current),
    };
  }

  function resultFromReceipt(receipt: DocumentFacadeReceiptLike | undefined): EditorRuntimeCommandResult {
    if (receipt?.success === true) {
      invalidatePositionTokens();
      return { status: 'committed', receipt };
    }
    if (receipt && 'failure' in receipt) {
      return { status: 'receipt-failure', failure: receipt.failure };
    }
    return { status: 'rejected', reason: 'command-failed' };
  }

  function resultFromHistory(
    kind: 'history.undo' | 'history.redo',
    result: DocumentFacadeHistoryResultLike | undefined,
  ): EditorRuntimeCommandResult {
    if (!result) return { status: 'rejected', reason: 'command-failed' };
    if (result.noop === true) {
      return { status: 'history-noop', reason: historyNoopReason(kind, result), result };
    }
    invalidatePositionTokens();
    return { status: 'history-committed', result };
  }

  async function dispatchReviewCommand(command: EditorRuntimeCommand): Promise<EditorRuntimeCommandResult | null> {
    const reviewCommand = reviewCommandKindForSupport(command.kind);
    if (reviewCommand) {
      if (!isHostCommandSupported(snapshot, reviewCommand)) {
        const rejection = unsupportedRuntimeRejection(snapshot, reviewCommand);
        return { status: 'rejected', reason: rejection.reason, detail: rejection.detail };
      }
    }
    const historyCommand = commandKindForSupport(command.kind);
    if ((command.kind === 'history.undo' || command.kind === 'history.redo') && historyCommand) {
      if (!isHostCommandSupported(snapshot, historyCommand)) {
        const rejection = unsupportedRuntimeRejection(snapshot, historyCommand);
        return { status: 'rejected', reason: rejection.reason, detail: rejection.detail };
      }
    }
    const doc = getDocumentFacade();
    if (!doc) {
      return REVIEW_COMMANDS.includes(command.kind)
        ? { status: 'rejected', reason: 'review-command-unavailable' }
        : null;
    }
    try {
      switch (command.kind) {
        case 'comments.create': {
          const selection = await doc.selection?.current?.();
          const target = selection?.empty === false ? selection.target : undefined;
          return resultFromReceipt(await doc.comments?.create?.({ text: command.text, ...(target ? { target } : {}) }));
        }
        case 'comments.resolve':
          return resultFromReceipt(await doc.comments?.patch?.({ commentId: command.commentId, status: 'resolved' }));
        case 'comments.reopen':
          return resultFromReceipt(await doc.comments?.patch?.({ commentId: command.commentId, status: 'active' }));
        case 'comments.delete':
          return resultFromReceipt(await doc.comments?.delete?.({ commentId: command.commentId }));
        case 'comments.reply':
          return resultFromReceipt(
            await doc.comments?.create?.({ parentCommentId: command.parentCommentId, text: command.text }),
          );
        case 'comments.edit':
          return resultFromReceipt(await doc.comments?.patch?.({ commentId: command.commentId, text: command.text }));
        case 'trackedChanges.accept':
          return resultFromReceipt(
            await doc.trackChanges?.decide?.({ decision: 'accept', target: { kind: 'id', id: command.id } }),
          );
        case 'trackedChanges.reject':
          return resultFromReceipt(
            await doc.trackChanges?.decide?.({ decision: 'reject', target: { kind: 'id', id: command.id } }),
          );
        case 'trackedChanges.acceptAll':
          return resultFromReceipt(await doc.trackChanges?.decide?.({ decision: 'accept', target: { kind: 'all' } }));
        case 'trackedChanges.rejectAll':
          return resultFromReceipt(await doc.trackChanges?.decide?.({ decision: 'reject', target: { kind: 'all' } }));
        case 'history.undo':
          return resultFromHistory('history.undo', await doc.history?.undo?.());
        case 'history.redo':
          return resultFromHistory('history.redo', await doc.history?.redo?.());
        default:
          return null;
      }
    } catch (error) {
      return {
        status: 'rejected',
        reason: 'command-failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function handleHostSnapshot(next: HostSnapshotLike): void {
    snapshot = next;
    invalidatePositionTokens();
    syncSelectionSubscription();
    emit({ type: 'state-change', state: normalizeLifecycleState(next) });
    emit({ type: 'capabilities-change', capabilities: capabilities(next) });
    if (next.state === 'disposed' && !didDispose) {
      didDispose = true;
      hostUnsubscribe?.();
      pageMetricsUnsubscribe?.();
      selectionUnsubscribe?.();
      selectionUnsubscribe = null;
      emit({ type: 'disposed' });
      listeners.clear();
      if (!unregistered) {
        unregistered = true;
        onUnregister?.(id);
      }
    }
  }

  hostUnsubscribe = host.subscribe(handleHostSnapshot);
  pageMetricsUnsubscribe =
    host.subscribePageMetrics?.(() => {
      emit({ type: 'layout-change', layout: currentLayoutSnapshot() });
    }) ?? null;
  syncSelectionSubscription();

  async function dispatch(command: EditorRuntimeCommand): Promise<EditorRuntimeCommandResult> {
    const lifecycleState = normalizeLifecycleState(snapshot);
    if (lifecycleState === 'disposed') return { status: 'rejected', reason: 'runtime-not-ready' };
    if (lifecycleState === 'saving') return { status: 'rejected', reason: 'host-saving' };
    if (!isReadyLifecycleState(lifecycleState)) return { status: 'rejected', reason: 'runtime-not-ready' };

    const token = 'at' in command ? command.at : 'range' in command ? command.range : undefined;
    if (token) {
      const resolved = resolveToken(token);
      if (!resolved.ok) return { status: 'rejected', reason: resolved.reason };
      return {
        status: 'rejected',
        reason: 'target-unsupported',
        detail: 'positioned dispatch is deferred until the shared runtime can target host selections explicitly',
      };
    }

    if (command.kind === 'trackedChanges.setAuthoringMode') {
      host.setDocumentMode(command.mode === 'tracked' ? 'suggesting' : 'editing');
      invalidatePositionTokens();
      return { status: 'committed' };
    }

    const documentApiResult = await dispatchReviewCommand(command);
    if (documentApiResult) return documentApiResult;

    let mapped: HostCommandLike | null = null;
    switch (command.kind) {
      case 'text.insert':
        mapped = { kind: 'text.insert', text: command.text };
        break;
      case 'text.replace':
        mapped = { kind: 'text.replace', text: command.text };
        break;
      case 'text.deleteBackward':
        mapped = { kind: 'text.deleteBackward' };
        break;
      case 'text.deleteForward':
        mapped = { kind: 'text.deleteForward' };
        break;
      case 'text.paste':
        mapped = { kind: 'text.pastePlain', text: command.text };
        break;
      case 'history.undo':
        mapped = { kind: 'history.undo' };
        break;
      case 'history.redo':
        mapped = { kind: 'history.redo' };
        break;
      case 'structural.splitBlock':
        mapped = { kind: 'structural.enter' };
        break;
      case 'structural.indent':
        mapped = { kind: 'structural.listIndent' };
        break;
      case 'structural.outdent':
        mapped = { kind: 'structural.listOutdent' };
        break;
      default:
        return { status: 'rejected', reason: 'command-unsupported', detail: command.kind };
    }

    const result = await host.dispatch(mapped);
    switch (result.status) {
      case 'committed':
        invalidatePositionTokens();
        return { status: 'committed', receipt: result.receipt };
      case 'history-committed':
        invalidatePositionTokens();
        return { status: 'history-committed', result: result.result };
      case 'history-noop':
        return {
          status: 'history-noop',
          reason: historyNoopReason(command.kind, result.result),
          result: result.result,
        };
      case 'receipt-failure':
        return { status: 'receipt-failure', failure: result.failure };
      case 'rejected':
        return {
          status: 'rejected',
          reason: rejectionCode(result.rejection.code),
          detail: result.rejection.detail,
        };
    }
  }

  async function focus(options?: EditorRuntimeFocusOptions): Promise<boolean> {
    if (didDispose || snapshot.state === 'disposed') return false;
    const focusController = mountedFocusHandle?.focus;
    if (focusController && typeof focusController.focus === 'function') {
      const focused = await focusController.focus({
        restoreSelection: options?.restoreSelection,
        preventScroll: options?.preventScroll,
      });
      return focused !== false;
    }
    if (typeof root.focus === 'function') {
      root.focus({ preventScroll: options?.preventScroll });
      return true;
    }
    return false;
  }

  async function dispose(): Promise<void> {
    if (didDispose) return;
    await host.dispose();
    if (!didDispose) {
      didDispose = true;
      hostUnsubscribe?.();
      pageMetricsUnsubscribe?.();
      selectionUnsubscribe?.();
      selectionUnsubscribe = null;
      emit({ type: 'disposed' });
      listeners.clear();
      if (!unregistered) {
        unregistered = true;
        onUnregister?.(id);
      }
    }
  }

  const runtime: EditorRuntime = {
    id,
    kind: 'v2',
    documentId,
    root,

    getCapabilities: () => capabilities(),
    getSnapshot: () => runtimeSnapshot(),
    setDocumentMode(mode) {
      host.setDocumentMode(mode);
    },
    getDocumentMode: () => host.getDocumentMode(),
    setTrackedChangesRenderOptions(options) {
      host.setTrackedChangesRenderOptions(options);
    },
    setShowFormattingMarks(show) {
      host.setShowFormattingMarks(show);
    },
    getLegacyEditorProjection: () => getLegacyEditorProjection?.() ?? DEFAULT_V2_LEGACY_PROJECTION,

    focus,
    dispose,

    dispatch,

    getSelectedText: () => '',
    getSelectionSnapshot: selectionSnapshot,
    getToolbarState(): EditorRuntimeToolbarState | null {
      return { activeMarks: [], disabled: ['formatting.applyMark', 'formatting.applyParagraph'] };
    },
    getLayoutSnapshot: currentLayoutSnapshot,

    save: () => host.save(),
    exportDocx: (options?: EditorRuntimeExportOptions) =>
      host.save({
        format: 'docx',
        ...resolveV2DocxExportOptions(options),
      }),

    async setZoom(percent) {
      const result = host.setZoom(percent);
      if (result.status === 'ok') return { status: 'committed' };
      return {
        status: 'rejected',
        reason: result.reason === 'host-disposed' ? 'runtime-not-ready' : 'target-unsupported',
        detail: result.reason,
      };
    },
    async reveal(target: EditorRuntimeNavigationTarget) {
      if (target.kind === 'position') {
        const resolved = resolveToken(target.position);
        if (!resolved.ok) return { status: 'rejected', reason: resolved.reason };
      }
      return {
        status: 'rejected',
        reason: 'capability-unsupported',
        detail: `${target.kind} reveal is not exposed through the shared runtime yet`,
      };
    },

    subscribe(listener: EditorRuntimeListener): EditorRuntimeUnsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    runtime,
    attachMountHandle(handle) {
      mountedFocusHandle = handle;
      syncSelectionSubscription();
    },
  };
}
