import { describe, expect, it } from 'bun:test';
import { normalizeMutationOptions, validateChangeMode } from './write.js';
import { DocumentApiValidationError } from '../errors.js';

describe('validateChangeMode', () => {
  it('accepts the canonical values and an absent value', () => {
    expect(() => validateChangeMode('direct')).not.toThrow();
    expect(() => validateChangeMode('tracked')).not.toThrow();
    expect(() => validateChangeMode(undefined)).not.toThrow();
  });

  it('rejects an out-of-enum string as a semantic INVALID_INPUT error', () => {
    let caught: unknown;
    try {
      validateChangeMode('banana');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DocumentApiValidationError);
    expect((caught as DocumentApiValidationError).code).toBe('INVALID_INPUT');
    // The error must be identifiable as a changeMode failure so the CLI error
    // mapping can preserve INVALID_INPUT instead of folding it into the
    // per-family INVALID_ARGUMENT mapping.
    expect((caught as DocumentApiValidationError).details?.field).toBe('changeMode');
  });

  it('rejects malformed values even when a dynamic caller bypasses structural validation', () => {
    for (const value of [123, null, false, {}, []]) {
      try {
        validateChangeMode(value);
        throw new Error('Expected malformed changeMode to be rejected.');
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentApiValidationError);
        expect((error as DocumentApiValidationError).code).toBe('VALIDATION_ERROR');
        expect((error as DocumentApiValidationError).details?.field).toBe('changeMode');
      }
    }
  });
});

describe('normalizeMutationOptions', () => {
  it('rejects null instead of defaulting it to a direct edit', () => {
    expect(() => normalizeMutationOptions({ changeMode: null as never })).toThrow(DocumentApiValidationError);
  });
  it('rejects an unsupported changeMode with INVALID_INPUT', () => {
    expect(() => normalizeMutationOptions({ changeMode: 'banana' as never })).toThrow(DocumentApiValidationError);
  });

  it('defaults changeMode to direct when options are omitted', () => {
    expect(normalizeMutationOptions()).toEqual({ changeMode: 'direct', dryRun: false });
  });

  it('defaults changeMode to direct when changeMode is undefined', () => {
    expect(normalizeMutationOptions({})).toEqual({ changeMode: 'direct', dryRun: false });
  });

  it('preserves explicit direct changeMode', () => {
    expect(normalizeMutationOptions({ changeMode: 'direct' })).toEqual({ changeMode: 'direct', dryRun: false });
  });

  it('preserves explicit tracked changeMode', () => {
    expect(normalizeMutationOptions({ changeMode: 'tracked' })).toEqual({ changeMode: 'tracked', dryRun: false });
  });

  it('preserves explicit dryRun true', () => {
    expect(normalizeMutationOptions({ dryRun: true })).toEqual({ changeMode: 'direct', dryRun: true });
  });
});
