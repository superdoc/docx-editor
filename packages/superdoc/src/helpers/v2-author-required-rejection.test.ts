import { describe, expect, it } from 'vite-plus/test';

import {
  createV2AuthorRequiredNotificationGate,
  isV2AuthorRequiredRejection,
  V2_AUTHOR_REQUIRED_CODE,
  V2_AUTHOR_REQUIRED_MESSAGE,
} from './v2-author-required-rejection.js';

describe('isV2AuthorRequiredRejection', () => {
  it('matches a receipt-source PRECONDITION_FAILED / no-author-configured rejection', () => {
    expect(
      isV2AuthorRequiredRejection({
        type: 'mutation:rejected',
        origin: 'command',
        failureSource: 'receipt',
        failure: { code: 'PRECONDITION_FAILED', message: 'no-author-configured' },
      }),
    ).toBe(true);
  });

  it('suppresses duplicate delivery of the same rejection within its document session', () => {
    const gate = createV2AuthorRequiredNotificationGate();
    const rejection = {
      type: 'mutation:rejected',
      failureSource: 'receipt',
      failure: { code: 'PRECONDITION_FAILED', message: 'no-author-configured' },
    };
    expect(gate.shouldNotify('doc-a', rejection)).toBe(true);
    expect(gate.shouldNotify('doc-a', rejection)).toBe(false);
    expect(gate.shouldNotify('doc-b', rejection)).toBe(true);
    gate.clear('doc-a');
    expect(gate.shouldNotify('doc-a', rejection)).toBe(true);
    expect(gate.shouldNotify('doc-b', rejection)).toBe(false);
  });

  it('reports a second author-required attempt before any successful mutation', () => {
    const gate = createV2AuthorRequiredNotificationGate();
    const rejection = () => ({
      type: 'mutation:rejected',
      failureSource: 'receipt',
      failure: { code: 'PRECONDITION_FAILED', message: 'no-author-configured' },
    });
    expect(gate.shouldNotify('doc-a', rejection())).toBe(true);
    expect(gate.shouldNotify('doc-a', rejection())).toBe(true);
  });

  it('matches a shell-source author-required rejection', () => {
    expect(
      isV2AuthorRequiredRejection({
        type: 'mutation:rejected',
        failureSource: 'shell',
        reason: 'author-required',
        message: 'author required',
      }),
    ).toBe(true);
  });

  it('ignores non-author rejections (invalid-range, read-only, etc.)', () => {
    expect(
      isV2AuthorRequiredRejection({
        type: 'mutation:rejected',
        failureSource: 'receipt',
        failure: { code: 'INVALID_TARGET', message: 'invalid-range' },
      }),
    ).toBe(false);
    expect(
      isV2AuthorRequiredRejection({
        type: 'mutation:rejected',
        failureSource: 'shell',
        reason: 'read-only',
      }),
    ).toBe(false);
  });

  it('ignores non-rejection events and nullish input', () => {
    expect(isV2AuthorRequiredRejection({ type: 'mutation:committed' })).toBe(false);
    expect(isV2AuthorRequiredRejection({ type: 'source:complete' })).toBe(false);
    expect(isV2AuthorRequiredRejection(null)).toBe(false);
    expect(isV2AuthorRequiredRejection(undefined)).toBe(false);
  });

  it('exposes a content-safe actionable message and stable code', () => {
    expect(V2_AUTHOR_REQUIRED_CODE).toBe('author-required');
    expect(V2_AUTHOR_REQUIRED_MESSAGE).toContain('user.name');
    // No document text / imported author / email / path / raw kernel reason.
    expect(V2_AUTHOR_REQUIRED_MESSAGE).not.toMatch(/@|\/word\/|no-author-configured/);
  });
});
