import type { BlocksAdapter } from './blocks.js';
import type { BlocksFindTextInput, BlocksFindTextResult } from '../types/blocks.types.js';
import { DocumentApiValidationError } from '../errors.js';
import { assertNoUnknownFields } from '../validation-primitives.js';

const ALLOWED_KEYS = new Set(['text', 'limit']);
const SCAN_PAGE = 2000;
const SCAN_CAP = 20000;

export function executeBlocksFindText(adapter: BlocksAdapter, input: BlocksFindTextInput): BlocksFindTextResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'blocks.findText requires an input object.');
  }
  assertNoUnknownFields(input as unknown as Record<string, unknown>, ALLOWED_KEYS, 'blocks.findText');
  if (typeof input.text !== 'string' || input.text.trim().length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'blocks.findText text must be a non-blank string.', {
      fields: ['text'],
    });
  }
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 0)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'blocks.findText limit must be a non-negative integer.', {
      fields: ['limit'],
    });
  }

  const needle = input.text.toLowerCase();
  const limit = input.limit ?? 8;
  const result: BlocksFindTextResult = {
    total: 0,
    matches: [],
    scannedBlocks: 0,
    truncated: false,
    revision: 'unknown',
  };
  // Keep flattened block semantics beside the adapter: occurrence search would
  // count repeated hits and nested table paragraphs as separate results.
  for (let offset = 0; offset < SCAN_CAP; offset += SCAN_PAGE) {
    let page;
    try {
      page = adapter.list({ offset, limit: SCAN_PAGE, includeText: true });
    } catch (error) {
      // Preserve completed pages when a later read fails, and expose why the
      // count is partial instead of presenting it as a complete search.
      result.scanError = { message: error instanceof Error ? error.message : String(error) };
      break;
    }
    result.revision = page.revision;
    for (const block of page.blocks) {
      if (!block.text || !block.text.toLowerCase().includes(needle)) continue;
      result.total += 1;
      result.firstMatchOrdinal ??= block.ordinal;
      if (result.matches.length < limit) {
        result.matches.push({
          ordinal: block.ordinal,
          nodeId: block.nodeId,
          nodeType: block.nodeType,
          preview: block.text.slice(0, 100),
        });
      }
    }
    result.scannedBlocks += page.blocks.length;
    if (page.blocks.length < SCAN_PAGE || result.scannedBlocks >= page.total) break;
    result.truncated = offset + SCAN_PAGE >= SCAN_CAP;
  }
  return result;
}
