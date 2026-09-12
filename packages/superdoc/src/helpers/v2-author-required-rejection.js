import { createV2MutationRejectionNotificationGate } from './v2-mutation-exception.js';

const NO_AUTHOR_SIGNAL = 'no-author-configured';

/** Stable, non-terminal exception code surfaced to consumers. */
export const V2_AUTHOR_REQUIRED_CODE = 'author-required';

/**
 * Content-safe, actionable message. Contains no document text, imported author,
 * email, path, or source key — only how to fix the configuration.
 */
export const V2_AUTHOR_REQUIRED_MESSAGE =
  'This edit needs an author identity. Set `user.name` in your SuperDoc configuration and reopen the document to make tracked or revision-overlapping edits.';

function messageHasNoAuthorSignal(message) {
  return typeof message === 'string' && message.includes(NO_AUTHOR_SIGNAL);
}

/**
 * @param {any} event - a `v2-host-event` payload.
 * @returns {boolean} true when the rejection means the session needs an author.
 */
export function isV2AuthorRequiredRejection(event) {
  if (!event || event.type !== 'mutation:rejected') return false;
  // Receipt-source: the kernel reason mapped to a public receipt.
  if (event.failureSource === 'receipt') {
    const failure = event.failure;
    if (!failure) return false;
    return failure.code === 'PRECONDITION_FAILED' && messageHasNoAuthorSignal(failure.message);
  }
  // Shell-source: the editable-input bridge's own rejection taxonomy.
  if (event.failureSource === 'shell') {
    if (event.reason === V2_AUTHOR_REQUIRED_CODE) return true;
    return event.reason === 'PRECONDITION_FAILED' && messageHasNoAuthorSignal(event.message);
  }
  return false;
}

export function createV2AuthorRequiredNotificationGate() {
  return createV2MutationRejectionNotificationGate(isV2AuthorRequiredRejection);
}
