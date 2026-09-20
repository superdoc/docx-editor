import type { Receipt } from '../types/receipt.js';
import type { MutationOptions } from '../write/write.js';

export type ClearContentInput = Record<string, never>;

/**
 * Engine-specific adapter that clears all document body content.
 */
export interface ClearContentAdapter {
  /**
   * Clear the document body, replacing all content with a single empty paragraph.
   */
  clearContent(input: ClearContentInput, options?: MutationOptions): Receipt;
}

/**
 * Execute a clearContent operation through the provided adapter.
 *
 * @param adapter - Engine-specific clear-content adapter.
 * @param input - Canonical clear-content input (empty object).
 * @param options - Optional change mode, preview and revision guard options.
 * @returns A Receipt indicating success or NO_OP if already empty.
 */
export function executeClearContent(
  adapter: ClearContentAdapter,
  input: ClearContentInput,
  options?: MutationOptions,
): Receipt {
  return adapter.clearContent(input, options);
}
