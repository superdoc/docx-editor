import { describe, expect, it } from 'bun:test';
import { executeBlocksDelete, type BlocksAdapter } from '../blocks/blocks.js';
import type { BlocksDeleteResult } from '../types/blocks.types.js';
import { DocumentApiValidationError } from '../errors.js';
import { OPERATION_DEFINITIONS } from './operation-definitions.js';

function makeAdapter(result?: BlocksDeleteResult): BlocksAdapter {
  const defaultResult: BlocksDeleteResult = {
    success: true,
    deleted: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
  };

  return {
    delete: () => result ?? defaultResult,
  };
}

describe('blocks.delete contract metadata', () => {
  it('declares INVALID_INPUT in throws.preApply for malformed input', () => {
    try {
      executeBlocksDelete(makeAdapter(), null as never);
      expect.unreachable('expected INVALID_INPUT validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentApiValidationError);
      expect((error as DocumentApiValidationError).code).toBe('INVALID_INPUT');
    }

    expect(OPERATION_DEFINITIONS['blocks.delete'].metadata.throws.preApply).toContain('INVALID_INPUT');
  });
});
