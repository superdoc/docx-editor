import { isObjectRecord, isPlainObject } from '../../helpers/object-guards.js';
import { hostMethod, safeCall } from './command-results.js';
import type { LooseRecord } from './loose-record.js';
import { SUPERDOC_UI_REASONS, type SuperDocUIReason } from './reasons.js';
import type { SuperDocUIState } from './types.js';

export type DocumentMode = SuperDocUIState['documentMode'];

export interface DocumentPolicyDeps {
  superdoc: unknown;
  getEditor: () => LooseRecord | null;
}

export interface DocumentPolicy {
  readDocumentMode: () => DocumentMode;
  documentIsReadOnly: () => boolean;
  commentsAreReadOnly: () => boolean;
  commentMutationsAreReadOnly: () => boolean;
  resolveIsForbidden: () => boolean;
  trackedChangeDecisionDisabledReason: () => SuperDocUIReason | undefined;
  trackedChangeDecisionsAreDisabled: () => boolean;
}

export function normalizeDocumentMode(value: unknown): DocumentMode {
  return value === 'editing' || value === 'suggesting' || value === 'viewing' ? value : null;
}

function readMember(owner: unknown, key: string): unknown {
  return owner === null || owner === undefined ? undefined : Reflect.get(Object(owner), key, owner);
}

export function createDocumentPolicy(deps: DocumentPolicyDeps): DocumentPolicy {
  const superdocRecord = (): LooseRecord | null => (isObjectRecord(deps.superdoc) ? deps.superdoc : null);

  const resolvedInteractionPolicy = (section: 'comments' | 'trackedChanges'): unknown =>
    readMember(readMember(superdocRecord(), 'interactionConfig'), section);

  const legacyCommentsModule = (): unknown =>
    readMember(readMember(readMember(superdocRecord(), 'config'), 'modules'), 'comments');

  const resolvedBooleanIsSet = (policy: unknown, field: string): boolean =>
    Boolean(policy) && typeof readMember(policy, field) === 'boolean';

  const legacyCommentsField = (field: string): unknown => {
    const comments = legacyCommentsModule();
    return isObjectRecord(comments) ? comments[field] : undefined;
  };

  const readDocumentMode = (): DocumentMode => {
    const editor = deps.getEditor();
    const record = superdocRecord();
    const configModeWinsWhileModeChangeSettles = normalizeDocumentMode(
      readMember(readMember(record, 'config'), 'documentMode'),
    );
    if (configModeWinsWhileModeChangeSettles) return configModeWinsWhileModeChangeSettles;
    const getActiveRuntime = hostMethod(record, 'getActiveRuntime');
    const runtimeSnapshot = safeCall<unknown>(
      getActiveRuntime ? () => hostMethod(getActiveRuntime(), 'getSnapshot')?.() ?? null : undefined,
      null,
    );
    const fromRuntime = normalizeDocumentMode(
      isPlainObject(runtimeSnapshot) ? runtimeSnapshot.documentMode : undefined,
    );
    const fromOptions = normalizeDocumentMode(readMember(editor?.options, 'documentMode'));

    return fromRuntime ?? fromOptions;
  };

  const documentIsReadOnly = (): boolean => {
    if (readDocumentMode() === 'viewing') return true;
    const connection = safeCall<unknown>(() => hostMethod(deps.superdoc, 'getCollaborationConnectionState')?.(), null);
    return isPlainObject(connection) && connection.state === 'failed';
  };

  const commentsAreReadOnly = (): boolean => {
    const resolved = resolvedInteractionPolicy('comments');
    if (resolvedBooleanIsSet(resolved, 'readOnly')) return readMember(resolved, 'readOnly') === true;
    return legacyCommentsField('readOnly') === true;
  };

  const resolveIsForbidden = (): boolean => {
    const resolved = resolvedInteractionPolicy('comments');
    if (resolvedBooleanIsSet(resolved, 'allowResolve')) return readMember(resolved, 'allowResolve') === false;
    return legacyCommentsField('allowResolve') === false;
  };

  const legacyHostDecisionReason = (): SuperDocUIReason | undefined =>
    commentsAreReadOnly() ? SUPERDOC_UI_REASONS.documentReadonly : undefined;

  const trackedChangeDecisionDisabledReason = (): SuperDocUIReason | undefined => {
    if (documentIsReadOnly()) return SUPERDOC_UI_REASONS.documentReadonly;
    const trackedChanges = resolvedInteractionPolicy('trackedChanges');
    if (resolvedBooleanIsSet(trackedChanges, 'allowDecisions')) {
      return readMember(trackedChanges, 'allowDecisions')
        ? undefined
        : SUPERDOC_UI_REASONS.trackedChangeDecisionsDisabled;
    }
    return legacyHostDecisionReason();
  };

  return {
    readDocumentMode,
    documentIsReadOnly,
    commentsAreReadOnly,
    commentMutationsAreReadOnly: commentsAreReadOnly,
    resolveIsForbidden,
    trackedChangeDecisionDisabledReason,
    trackedChangeDecisionsAreDisabled: () => trackedChangeDecisionDisabledReason() !== undefined,
  };
}
