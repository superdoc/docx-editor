import { describe, it, expect, mock } from 'bun:test';
import {
  executeTemplatesApply,
  type TemplatesAdapter,
  type TemplatesApplyInput,
  type TemplatesApplyReceipt,
  type NormalizedTemplatesApplyOptions,
} from './apply.js';
import { DocumentApiValidationError } from '../errors.js';

function okReceipt(dryRun: boolean): TemplatesApplyReceipt {
  return {
    success: true,
    changed: true,
    dryRun,
    bodyPolicy: 'preserve',
    source: { kind: 'base64', fingerprint: 'deadbeef', partCount: 3 },
    detectedScopes: [{ scope: 'styles', part: 'word/styles.xml' }],
    appliedScopes: [{ scope: 'styles', part: 'word/styles.xml' }],
    skippedScopes: [],
    unsupportedItems: [],
    changedParts: [{ part: 'word/styles.xml', scope: 'styles', change: 'merged' }],
    idMappings: {},
    warnings: [],
  };
}

function makeAdapter(): TemplatesAdapter & {
  apply: ReturnType<typeof mock>;
} {
  return {
    // The adapter is async (SD-3247): it resolves the receipt after loading the
    // source package. The mock mirrors that by returning a Promise.
    apply: mock((_input: TemplatesApplyInput, options: NormalizedTemplatesApplyOptions) =>
      Promise.resolve(okReceipt(options.dryRun)),
    ),
  };
}

describe('executeTemplatesApply contract', () => {
  it('rejects tracked requests before normalization can discard the mode', () => {
    const adapter = makeAdapter();
    const input: TemplatesApplyInput = { source: { kind: 'path', path: '/tmp/template.docx' } };
    const options = { changeMode: 'tracked' } as unknown as Parameters<typeof executeTemplatesApply>[2];
    expect(() => executeTemplatesApply(adapter, input, options)).toThrow('does not support tracked changes');
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('routes a valid path source to the adapter and resolves a receipt asynchronously', async () => {
    const adapter = makeAdapter();
    const input: TemplatesApplyInput = { source: { kind: 'path', path: '/tmp/template.docx' } };
    const pending = executeTemplatesApply(adapter, input, { expectedRevision: 7 });

    // The adapter is invoked synchronously with normalized options...
    expect(adapter.apply).toHaveBeenCalledTimes(1);
    const [, options] = adapter.apply.mock.calls[0];
    expect(options).toEqual({ dryRun: false, expectedRevision: '7' });

    // ...but the receipt resolves asynchronously (await required).
    expect(pending).toBeInstanceOf(Promise);
    const receipt = await pending;
    expect(receipt.success).toBe(true);
  });

  it('normalizes dryRun and stringifies expectedRevision', async () => {
    const adapter = makeAdapter();
    await executeTemplatesApply(adapter, { source: { kind: 'base64', data: 'AAAA' } }, { dryRun: true });
    const [, options] = adapter.apply.mock.calls[0];
    expect(options).toEqual({ dryRun: true, expectedRevision: undefined });
  });

  it('accepts bodyPolicy: preserve', async () => {
    const adapter = makeAdapter();
    const receipt = await executeTemplatesApply(adapter, {
      source: { kind: 'path', path: '/a.docx' },
      bodyPolicy: 'preserve',
    });
    expect(receipt.success).toBe(true);
  });

  it.each(['narrow', 'error'] as const)(
    'throws exact INVALID_INPUT for the unsupported onUnsupportedContent=%s field',
    (policy) => {
      const adapter = makeAdapter();
      let thrown: unknown;

      try {
        executeTemplatesApply(adapter, {
          source: { kind: 'path', path: '/a.docx' },
          onUnsupportedContent: policy,
        } as unknown as TemplatesApplyInput);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(DocumentApiValidationError);
      expect(thrown).toMatchObject({
        name: 'DocumentApiValidationError',
        code: 'INVALID_INPUT',
        message: 'Unknown field "onUnsupportedContent" on templates.apply input. Allowed fields: source, bodyPolicy.',
        details: { field: 'onUnsupportedContent' },
      });
      expect(adapter.apply).not.toHaveBeenCalled();
    },
  );

  it('throws INVALID_INPUT for a non-object input', () => {
    const adapter = makeAdapter();
    expect(() => executeTemplatesApply(adapter, null as unknown as TemplatesApplyInput)).toThrow(
      DocumentApiValidationError,
    );
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('throws INVALID_INPUT for a missing source', () => {
    const adapter = makeAdapter();
    let code: string | undefined;
    try {
      executeTemplatesApply(adapter, {} as unknown as TemplatesApplyInput);
    } catch (e) {
      code = (e as DocumentApiValidationError).code;
    }
    expect(code).toBe('INVALID_INPUT');
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('throws INVALID_INPUT for an unknown source.kind', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeTemplatesApply(adapter, { source: { kind: 'url', url: 'x' } } as unknown as TemplatesApplyInput),
    ).toThrow(DocumentApiValidationError);
  });

  it('throws INVALID_INPUT when path source has empty path', () => {
    const adapter = makeAdapter();
    expect(() => executeTemplatesApply(adapter, { source: { kind: 'path', path: '' } } as TemplatesApplyInput)).toThrow(
      DocumentApiValidationError,
    );
  });

  it('throws INVALID_INPUT when base64 source has empty data', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeTemplatesApply(adapter, { source: { kind: 'base64', data: '' } } as TemplatesApplyInput),
    ).toThrow(DocumentApiValidationError);
  });

  it('throws INVALID_INPUT for an invalid bodyPolicy', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeTemplatesApply(adapter, {
        source: { kind: 'path', path: '/a.docx' },
        bodyPolicy: 'replace',
      } as unknown as TemplatesApplyInput),
    ).toThrow(DocumentApiValidationError);
  });
});
