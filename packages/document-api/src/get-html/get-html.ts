import { DocumentApiValidationError } from '../errors.js';
import type { SDProjectionReadInput } from '../types/content-projection.js';
import { validateOptionalBoolean, validateProjectionReadInput } from '../content-projection/validation.js';

const GET_HTML_FIELDS = new Set(['in', 'reviewMode', 'scope', 'styling', 'unflattenLists']);

export interface GetHtmlInput extends SDProjectionReadInput {
  styling?: 'inline';
  /**
   * Accepted for compatibility and ignored by V2. V2 always emits canonical
   * nested semantic lists.
   *
   * @deprecated replaceWith=canonical nested V2 output compat-indefinitely=existing callers may keep passing the option
   */
  unflattenLists?: boolean;
}

/**
 * Engine-specific adapter that the getHtml API delegates to.
 */
export interface GetHtmlAdapter {
  /**
   * Return the full document content as an HTML string.
   */
  getHtml(input: GetHtmlInput): string;
}

/**
 * Execute a getHtml operation via the provided adapter.
 *
 * @param adapter - Engine-specific getHtml adapter.
 * @param input - Canonical getHtml input object.
 * @returns The full document content as an HTML string.
 */
export function executeGetHtml(adapter: GetHtmlAdapter, input: GetHtmlInput): string {
  validateProjectionReadInput(input, 'getHtml', GET_HTML_FIELDS);
  if (input.styling !== undefined && input.styling !== 'inline')
    throw new DocumentApiValidationError('INVALID_INPUT', 'styling must be inline.', { operation: 'getHtml' });
  validateOptionalBoolean(input.unflattenLists, 'unflattenLists', 'getHtml');
  return adapter.getHtml(input);
}
