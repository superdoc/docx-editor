import { describe, it, expect } from 'vite-plus/test';
import { executeExportToDocx, type ExportAdapter } from './export.js';
import { DocumentApiValidationError } from '../errors.js';
import type { ExportToDocxResult, SDExportMode } from './export.types.js';

function stubAdapter(): { adapter: ExportAdapter; calls: SDExportMode[] } {
  const calls: SDExportMode[] = [];
  const adapter: ExportAdapter = {
    toDocx({ mode }): ExportToDocxResult {
      calls.push(mode);
      return {
        mode,
        byteLength: 3,
        contentBase64: 'AAAA',
        report: { warnings: [] },
      };
    },
  };
  return { adapter, calls };
}

describe('executeExportToDocx', () => {
  it('forwards independent policies with preserving defaults', () => {
    let received: unknown;
    const adapter: ExportAdapter = {
      toDocx(input) {
        received = input;
        return stubAdapter().adapter.toDocx(input);
      },
    };
    executeExportToDocx(adapter, { policies: { comments: 'resolve', contentControls: 'flatten' } });
    expect(received).toEqual({
      mode: 'review-preserving',
      policies: { trackedChanges: 'review-preserving', comments: 'resolve', contentControls: 'flatten' },
    });
  });

  it.each([
    { policies: { comments: 'banana' } },
    { policies: { contentControls: 'remove' } },
    { policies: { trackedChanges: 'accept' } },
    { policies: { fields: 'flatten' } },
    { policies: null },
    { policies: [] },
    { mode: 'final', policies: { trackedChanges: 'original' } },
  ])('rejects invalid or conflicting policies before dispatch: %j', (input) => {
    const { adapter, calls } = stubAdapter();
    expect(() => executeExportToDocx(adapter, input as never)).toThrow(DocumentApiValidationError);
    expect(calls).toEqual([]);
  });

  it('defaults to review-preserving when no mode is supplied', () => {
    const { adapter, calls } = stubAdapter();
    const result = executeExportToDocx(adapter, {});
    expect(result.mode).toBe('review-preserving');
    expect(calls).toEqual(['review-preserving']);
  });

  it('delegates each documented mode to the adapter', () => {
    for (const mode of ['review-preserving', 'final', 'original'] as const) {
      const { adapter, calls } = stubAdapter();
      const result = executeExportToDocx(adapter, { mode });
      expect(result.mode).toBe(mode);
      expect(calls).toEqual([mode]);
    }
  });

  it('fails closed with INVALID_INPUT for an unknown mode before touching the adapter', () => {
    const { adapter, calls } = stubAdapter();
    try {
      // Force an invalid mode past the type system, mirroring a malformed
      // runtime payload (e.g. `{ mode: 'banana' }`).
      executeExportToDocx(adapter, { mode: 'banana' as unknown as SDExportMode });
      throw new Error('expected executeExportToDocx to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentApiValidationError);
      expect((error as DocumentApiValidationError).code).toBe('INVALID_INPUT');
    }
    // No adapter work happened: the document is never mutated for a bad mode.
    expect(calls).toEqual([]);
  });

  it('fails closed with INVALID_INPUT for a non-object input', () => {
    const { adapter } = stubAdapter();
    try {
      executeExportToDocx(adapter, 42 as unknown as { mode?: SDExportMode });
      throw new Error('expected executeExportToDocx to throw');
    } catch (error) {
      expect((error as DocumentApiValidationError).code).toBe('INVALID_INPUT');
    }
  });

  it('reports CAPABILITY_UNSUPPORTED when no engine adapter is wired', () => {
    try {
      executeExportToDocx(undefined, { mode: 'final' });
      throw new Error('expected executeExportToDocx to throw');
    } catch (error) {
      expect((error as DocumentApiValidationError).code).toBe('CAPABILITY_UNSUPPORTED');
    }
  });
});
