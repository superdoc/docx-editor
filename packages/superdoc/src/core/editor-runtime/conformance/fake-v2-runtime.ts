// Fake v2 runtime conformance fixture.
//
// Proves the editor-runtime contract is implementable without importing the
// concrete private v2 editor package. The adapter-private position store below
// exercises the opaque-token discipline the shell depends on.

import type {
  EditorRuntime,
  EditorRuntimeCapabilities,
  EditorRuntimeCommand,
  EditorRuntimeCommandKind,
  EditorRuntimeCommandResult,
  EditorRuntimeDocumentMode,
  EditorRuntimeEvent,
  EditorRuntimeFindSessionSnapshot,
  EditorRuntimeFocusOptions,
  EditorRuntimeId,
  EditorRuntimeLayoutSnapshot,
  EditorRuntimeListener,
  EditorRuntimeNavigationTarget,
  EditorRuntimePositionToken,
  EditorRuntimeSelectionSnapshot,
  EditorRuntimeSnapshot,
  EditorRuntimeState,
  EditorRuntimeToolbarState,
  EditorRuntimeUnsubscribe,
} from '../index.js';

interface FakeV2RuntimeOptions {
  id?: EditorRuntimeId;
  documentId?: string;
  root?: HTMLElement;
  initialState?: EditorRuntimeState;
  initialDocumentMode?: EditorRuntimeDocumentMode;
}

const SUPPORTED_COMMAND_KINDS: readonly EditorRuntimeCommandKind[] = [
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
  'formatting.applyMark',
  'formatting.applyParagraph',
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
  'trackedChanges.setAuthoringMode',
];

/** Minimal stand-in for an element when no DOM root is provided. */
function fallbackRoot(): HTMLElement {
  if (typeof document !== 'undefined') return document.createElement('div');
  return {} as HTMLElement;
}

export function createFakeV2Runtime(options: FakeV2RuntimeOptions = {}): EditorRuntime {
  const id: EditorRuntimeId = options.id ?? 'fake-v2';
  const documentId = options.documentId ?? 'doc-v2';
  const root = options.root ?? fallbackRoot();

  let state: EditorRuntimeState = options.initialState ?? 'editing-ready';
  let documentMode: EditorRuntimeDocumentMode = options.initialDocumentMode ?? 'editing';
  let revision = 0;
  let zoomPercent = 100;
  const selectionText = 'hello';
  const listeners = new Set<EditorRuntimeListener>();

  const positions = new Map<string, unknown>();
  let tokenSeq = 0;

  function mintToken(position: unknown): EditorRuntimePositionToken {
    const tokenId = `v2-pos-${tokenSeq++}`;
    positions.set(tokenId, position);
    return { runtimeId: id, tokenId, revision };
  }

  function resolveToken(
    token: EditorRuntimePositionToken,
  ): { ok: true } | { ok: false; reason: 'wrong-runtime-token' | 'stale-position-token' } {
    if (token.runtimeId !== id) return { ok: false, reason: 'wrong-runtime-token' };
    if (token.revision !== revision || !positions.has(token.tokenId)) {
      return { ok: false, reason: 'stale-position-token' };
    }
    return { ok: true };
  }

  function emit(event: EditorRuntimeEvent): void {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch {
        /* listener errors must not break dispatch */
      }
    }
  }

  function capabilities(): EditorRuntimeCapabilities {
    return {
      lifecycle: { canFocus: true, canDispose: true },
      selection: { canReadSelectedText: true, canReadSelectionSnapshot: true, canMintPositionTokens: true },
      commands: {
        canDispatch: state !== 'disposed' && state !== 'saving' && documentMode !== 'viewing',
        supportedCommands: SUPPORTED_COMMAND_KINDS,
      },
      layout: { supported: true, hasSyncSnapshot: true },
      zoom: { supported: true, min: 25, max: 400 },
      navigation: { supported: true, targets: ['position', 'page', 'search-result'] },
      persistence: { canSave: true, canExportDocx: true },
      findReplace: { supported: true, hasSyncSessionSnapshot: true, canReplace: true },
      comments: { supported: true, canMutate: true },
      trackedChanges: { supported: true, canDecide: true, canToggleAuthoring: true },
      toolbar: { supported: true, emitsStateChange: true },
    };
  }

  return {
    id,
    kind: 'v2',
    documentId,
    root,

    getCapabilities: capabilities,
    getSnapshot(): EditorRuntimeSnapshot {
      return { id, kind: 'v2', documentId, state, documentMode, capabilities: capabilities() };
    },
    setDocumentMode(mode: EditorRuntimeDocumentMode): void {
      documentMode = mode;
    },
    getDocumentMode(): EditorRuntimeDocumentMode {
      return documentMode;
    },
    setTrackedChangesRenderOptions(): void {},
    setShowFormattingMarks(): void {},
    getLegacyEditorProjection() {
      return {
        editorVersion: 2,
        documentId,
        options: { documentId },
        commands: null,
        state: null,
        view: null,
      };
    },

    async focus(_options?: EditorRuntimeFocusOptions): Promise<boolean> {
      return true;
    },
    dispose(): void {
      state = 'disposed';
      emit({ type: 'disposed' });
      listeners.clear();
      positions.clear();
    },

    async dispatch(command: EditorRuntimeCommand): Promise<EditorRuntimeCommandResult> {
      if (state === 'disposed') return { status: 'rejected', reason: 'runtime-not-ready' };
      if (state === 'saving') return { status: 'rejected', reason: 'host-saving' };
      if (documentMode === 'viewing') return { status: 'rejected', reason: 'document-readonly' };

      const token = 'at' in command ? command.at : 'range' in command ? command.range : undefined;
      if (token) {
        const resolved = resolveToken(token);
        if (!resolved.ok) return { status: 'rejected', reason: resolved.reason };
      }

      const commandKind = (command as { kind?: unknown }).kind;
      if (
        typeof commandKind !== 'string' ||
        !SUPPORTED_COMMAND_KINDS.includes(commandKind as EditorRuntimeCommandKind)
      ) {
        return { status: 'rejected', reason: 'command-unsupported' };
      }

      switch (command.kind) {
        case 'history.undo':
          if (revision === 0) return { status: 'history-noop', reason: 'nothing-to-undo' };
          revision -= 1;
          return { status: 'history-committed' };
        case 'history.redo':
          return { status: 'history-noop', reason: 'nothing-to-redo' };
        case 'trackedChanges.setAuthoringMode':
          documentMode = command.mode === 'tracked' ? 'suggesting' : 'editing';
          return { status: 'committed', receipt: { revision } };
        default:
          revision += 1;
          return { status: 'committed', receipt: { revision } };
      }
    },

    getSelectedText(): string {
      return selectionText;
    },
    getSelectionSnapshot(): EditorRuntimeSelectionSnapshot | null {
      const isEmpty = selectionText.length === 0;
      return {
        isRange: !isEmpty,
        isEmpty,
        text: selectionText,
        anchor: mintToken({ offset: 1 }),
        focus: mintToken({ offset: 1 + selectionText.length }),
      };
    },
    getFindSessionSnapshot(): EditorRuntimeFindSessionSnapshot | null {
      return { active: false, query: '', matchCount: 0, activeMatchIndex: -1 };
    },
    getToolbarState(): EditorRuntimeToolbarState | null {
      return { activeMarks: [], disabled: [] };
    },
    getLayoutSnapshot(): EditorRuntimeLayoutSnapshot | null {
      return { pageCount: 1, currentPage: 1, zoom: zoomPercent };
    },

    async save(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
    async exportDocx(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },

    async setZoom(percent: number): Promise<EditorRuntimeCommandResult> {
      if (percent < 25 || percent > 400) return { status: 'rejected', reason: 'target-unsupported' };
      zoomPercent = percent;
      emit({ type: 'layout-change', layout: { pageCount: 1, currentPage: 1, zoom: zoomPercent } });
      return { status: 'committed' };
    },
    async reveal(target: EditorRuntimeNavigationTarget): Promise<EditorRuntimeCommandResult> {
      if (target.kind === 'comment') return { status: 'rejected', reason: 'target-unsupported' };
      if (target.kind === 'position') {
        const resolved = resolveToken(target.position);
        if (!resolved.ok) return { status: 'rejected', reason: resolved.reason };
      }
      return { status: 'committed' };
    },

    subscribe(listener: EditorRuntimeListener): EditorRuntimeUnsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
