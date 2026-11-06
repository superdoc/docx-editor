import { normalizeCommentIdentity } from '@superdoc/document-api';
import type { User } from '../types/index.js';

/** Public compatibility identity used when a consumer omits `config.user`. */
export const DEFAULT_SUPERDOC_USER = Object.freeze({
  id: null,
  name: 'Default SuperDoc user',
  email: null,
});

/**
 * Normalize missing and partial public user configuration without sharing the
 * frozen default object between instances. The mounted v2 shell receives this
 * value and derives the session author used by worker and inline opens.
 */
export function normalizeSuperDocUser(user: User | null | undefined): User {
  if (!user || typeof user !== 'object') return { ...DEFAULT_SUPERDOC_USER };
  return {
    ...DEFAULT_SUPERDOC_USER,
    ...user,
    ...(user.commentIdentity !== undefined ? { commentIdentity: normalizeCommentIdentity(user.commentIdentity) } : {}),
  };
}
