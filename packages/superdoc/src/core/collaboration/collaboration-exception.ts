import type { SuperDocExceptionCollaborationPayload } from '../types/index.js';

export function createCollaborationException(
  code: string,
  documentId: string | null,
): SuperDocExceptionCollaborationPayload | null {
  let collaborationReason: SuperDocExceptionCollaborationPayload['collaborationReason'];
  let message: string;
  switch (code) {
    case 'collaboration-access-denied':
      collaborationReason = 'access-denied';
      message = 'The collaboration server rejected access to this room.';
      break;
    case 'collaboration-connection-failed':
      collaborationReason = 'connection-failed';
      message = 'The collaboration connection failed.';
      break;
    case 'collaboration-sync-timeout':
      collaborationReason = 'sync-timeout';
      message = 'The collaboration room did not finish synchronizing in time.';
      break;
    default:
      return null;
  }
  return { error: new Error(message), code, collaborationReason, documentId, editor: null };
}
