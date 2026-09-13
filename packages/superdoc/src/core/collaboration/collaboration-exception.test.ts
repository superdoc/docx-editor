import { describe, expect, it } from 'vitest';
import { createCollaborationException } from './collaboration-exception.js';

describe('collaboration connection exceptions', () => {
  it.each(['access-denied', 'connection-failed', 'sync-timeout'] as const)(
    'adds a typed %s reason to the existing exception event',
    (collaborationReason) => {
      const code = `collaboration-${collaborationReason}`;
      expect(createCollaborationException(code, 'doc-1')).toMatchObject({
        error: expect.any(Error),
        code,
        collaborationReason,
        documentId: 'doc-1',
        editor: null,
      });
    },
  );

  it.each(['worker-init-failed', 'open-failed', 'collaboration-room-corrupt'])(
    'does not classify %s as a collaboration connection failure',
    (reason) => expect(createCollaborationException(reason, null)).toBeNull(),
  );
});
