import {
  SuperDoc,
  type Config,
  type DocumentCollaborationConfig,
  type UpgradeToCollaborationOptions,
  type V2CollaborationConfig,
  type SuperDocExceptionCollaborationPayload,
  type UpgradeToCollaborationResult,
  type SuperDocCollaborationUpgradeError,
} from 'superdoc';

const collaboration = {
  providerType: 'hocuspocus',
  documentId: 'agreement',
  serverUrl: 'wss://collaboration.example.com',
  roomMode: 'join',
  syncTimeoutMs: 45_000,
} satisfies DocumentCollaborationConfig;

const config = {
  selector: '#editor',
  document: { url: '/agreement.docx', collaboration },
  onException(payload) {
    if ('collaborationReason' in payload) {
      const failure: SuperDocExceptionCollaborationPayload = payload;
      const reason: 'access-denied' | 'connection-failed' | 'sync-timeout' = failure.collaborationReason;
      const error: Error = failure.error;
      // @ts-expect-error A failed connection does not imply a worker startup failure.
      const workerCode: 'worker-init-failed' = failure.code;
      void [reason, error, workerCode];
    }
  },
} satisfies Config;

const legacy: V2CollaborationConfig = collaboration;
const legacyConfig = {
  selector: '#editor',
  document: { url: '/agreement.docx', v2Collaboration: legacy },
} satisfies Config;

const upgrade = { collaboration } satisfies UpgradeToCollaborationOptions;
const oldUpgrade = { v2Collaboration: legacy } satisfies UpgradeToCollaborationOptions;
const editor = new SuperDoc(config);
const upgradeArguments: Parameters<SuperDoc['upgradeToCollaboration']> = [upgrade];
const upgradeReturn: ReturnType<SuperDoc['upgradeToCollaboration']> = editor.upgradeToCollaboration(upgrade);
const result: Promise<UpgradeToCollaborationResult> = editor.upgradeToCollaboration(upgrade);
const oldResult: Promise<UpgradeToCollaborationResult> = editor.upgradeToCollaboration(oldUpgrade);
void result.then(({ roomId, documentId }) => {
  const attachedRoom: string = roomId;
  const mountedDocument: string = documentId;
  void [attachedRoom, mountedDocument];
});
const conflictCode: SuperDocCollaborationUpgradeError['code'] = 'collaboration-v2-room-already-exists';

// @ts-expect-error Collaboration does not accept an external Y.Doc.
const external: DocumentCollaborationConfig = { ydoc: {} };
// @ts-expect-error Room creation and joining are explicit operations.
const invalidMode: DocumentCollaborationConfig = { ...collaboration, roomMode: 'create-if-missing' };

void [legacyConfig, upgradeArguments, upgradeReturn, result, oldResult, conflictCode, external, invalidMode];
