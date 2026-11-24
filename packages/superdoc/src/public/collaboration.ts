import { resolveCollaborationRoomName as resolveEngineRoomName } from '@superdoc/docx-engine/collaboration';

export function resolveCollaborationRoomName(documentId: string): string {
  return resolveEngineRoomName(documentId);
}
