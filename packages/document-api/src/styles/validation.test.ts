import { describe, it, expect, mock } from 'bun:test';
import {
  executeStylesApply,
  executeStylesGetCatalog,
  PROPERTY_REGISTRY,
  EXCLUDED_KEYS,
  classifyPatchKey,
  type StylesAdapter,
  type StylesApplyReceipt,
  type ValueSchema,
} from './index.js';
import { DocumentApiValidationError } from '../errors.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeAdapter(): StylesAdapter {
  return {
    apply: mock(
      (): StylesApplyReceipt => ({
        success: true,
        changed: true,
        resolution: {
          scope: 'docDefaults',
          channel: 'run',
          xmlPart: 'word/styles.xml',
          xmlPath: 'w:styles/w:docDefaults/w:rPrDefault/w:rPr',
        },
        dryRun: false,
        before: {},
        after: {},
      }),
    ),
    getCatalog: () => ({
      version: 'style-catalog/v1',
      revision: null,
      view: 'all',
      defaults: { paragraphStyleId: null, characterStyleId: null, tableStyleId: null },
      items: [],
      styles: [],
      sourceStatus: {
        styles: 'present',
        settings: 'present',
        usage: 'unsupported',
        preview: 'unsupported',
        view: 'supported',
      },
      diagnostics: [],
    }),
  };
}

function makeApplyOnlyAdapter(): StylesAdapter {
  return {
    apply: mock(
      (): StylesApplyReceipt => ({
        success: true,
        changed: false,
        resolution: {
          scope: 'docDefaults',
          channel: 'run',
          xmlPart: 'word/styles.xml',
          xmlPath: 'w:styles/w:docDefaults/w:rPrDefault/w:rPr',
        },
        dryRun: false,
        before: {},
        after: {},
      }),
    ),
  };
}

function expectValidationError(fn: () => void, code: string, messagePattern?: RegExp) {
  try {
    fn();
    throw new Error('Expected DocumentApiValidationError to be thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(DocumentApiValidationError);
    expect((err as DocumentApiValidationError).code).toBe(code);
    if (messagePattern) {
      expect((err as DocumentApiValidationError).message).toMatch(messagePattern);
    }
  }
}

/** Generates a valid test value for a given schema. */
function validValueForSchema(schema: ValueSchema): unknown {
  switch (schema.kind) {
    case 'boolean':
      return true;
    case 'integer':
      return schema.min ?? 1;
    case 'enum':
      return schema.values[0];
    case 'string':
      return 'test';
    case 'object': {
      const firstKey = Object.keys(schema.children)[0];
      return { [firstKey]: validValueForSchema(schema.children[firstKey]) };
    }
    case 'array':
      return []; // Empty array is always valid
  }
}

/** Generates an invalid test value for a given schema. */
function invalidValueForSchema(schema: ValueSchema): unknown {
  switch (schema.kind) {
    case 'boolean':
      return 'not-a-boolean';
    case 'integer':
      return 'not-a-number';
    case 'enum':
      return 'INVALID_ENUM_VALUE';
    case 'string':
      return 42;
    case 'object':
      return 'not-an-object';
    case 'array':
      return 'not-an-array';
  }
}

// ---------------------------------------------------------------------------
// Registry-driven acceptance tests
// ---------------------------------------------------------------------------

describe('styles.apply validation: registry-driven property acceptance', () => {
  // Skips the registry entries docDefaults excludes: since the registry also
  // backs the `style` scope, "in the registry" no longer implies "accepted by
  // styles.apply". The excluded-key suite below covers those.
  for (const def of PROPERTY_REGISTRY.filter((d) => !EXCLUDED_KEYS[d.channel].has(d.key))) {
    it(`accepts valid ${def.channel}.${def.key} (${def.schema.kind})`, () => {
      const adapter = makeAdapter();
      const value = validValueForSchema(def.schema);
      expect(() =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: def.channel },
          patch: { [def.key]: value },
        }),
      ).not.toThrow();
    });
  }
});

describe('styles.getCatalog validation', () => {
  it('accepts an omitted input object for the default catalogue request', () => {
    const adapter = makeAdapter();
    expect(() => executeStylesGetCatalog(adapter)).not.toThrow();
  });

  it('accepts every declared catalogue view', () => {
    const adapter = makeAdapter();
    for (const view of ['quickGallery', 'recommended', 'currentDocument', 'all', 'inUse'] as const) {
      expect(() => executeStylesGetCatalog(adapter, { view })).not.toThrow();
    }
  });

  it('rejects null input instead of treating it as the default request', () => {
    const adapter = makeAdapter();
    expectValidationError(() => executeStylesGetCatalog(adapter, null as never), 'INVALID_INPUT', /non-null object/);
  });

  it('fails closed when an apply-only styles adapter omits the catalogue hook', () => {
    const adapter = makeApplyOnlyAdapter();

    expectValidationError(
      () => executeStylesGetCatalog(adapter),
      'CAPABILITY_UNAVAILABLE',
      /styles\.getCatalog is not available/,
    );
  });

  it('validates input before checking for the optional catalogue hook', () => {
    const adapter = makeApplyOnlyAdapter();

    expectValidationError(() => executeStylesGetCatalog(adapter, null as never), 'INVALID_INPUT', /non-null object/);
  });
});

// ---------------------------------------------------------------------------
// Registry-driven rejection tests
// ---------------------------------------------------------------------------

describe('styles.apply validation: registry-driven type rejection', () => {
  for (const def of PROPERTY_REGISTRY.filter((d) => !EXCLUDED_KEYS[d.channel].has(d.key))) {
    it(`rejects invalid ${def.channel}.${def.key} type`, () => {
      const adapter = makeAdapter();
      const value = invalidValueForSchema(def.schema);
      expectValidationError(
        () =>
          executeStylesApply(adapter, {
            target: { scope: 'docDefaults', channel: def.channel },
            patch: { [def.key]: value },
          }),
        'INVALID_INPUT',
      );
    });
  }
});

// ---------------------------------------------------------------------------
// classifyPatchKey — public export, reachable without a scope argument
// ---------------------------------------------------------------------------

describe('classifyPatchKey scope default', () => {
  // Exported from the package root, so an external caller can reach the
  // no-scope overload that no internal caller uses: validatePatchObject always
  // passes a scope. If the default ever flipped to 'style', styles.apply would
  // silently widen for every consumer that classifies keys itself.
  it('classifies against docDefaults when no scope is given', () => {
    expect(classifyPatchKey('rtl', 'run')).toEqual({ status: 'excluded', reason: 'w:rtl' });
    expect(classifyPatchKey('rtl', 'run', 'docDefaults')).toEqual({ status: 'excluded', reason: 'w:rtl' });
  });

  it('classifies the same key as valid under the style scope', () => {
    expect(classifyPatchKey('rtl', 'run', 'style')).toEqual({ status: 'valid' });
    expect(classifyPatchKey('highlight', 'run', 'style')).toEqual({ status: 'valid' });
  });

  it('keeps the other three statuses stable across scopes', () => {
    expect(classifyPatchKey('bold', 'run', 'style')).toEqual({ status: 'valid' });
    expect(classifyPatchKey('keepNext', 'run', 'style')).toEqual({
      status: 'cross_channel',
      ownerChannel: 'paragraph',
    });
    expect(classifyPatchKey('nope', 'run', 'style')).toEqual({ status: 'unknown' });
  });

  it('never offers a docDefaults-excluded key in the styles.apply "Allowed keys" list', () => {
    // The registry now also backs the style scope, so the list has to be
    // filtered: unfiltered, styles.apply would answer an unknown key by
    // offering rtl, cs, highlight and oMath as valid ones — and then reject
    // every one of them.
    const adapter = makeAdapter();
    try {
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'run' },
        patch: { nope: true } as never,
      });
      throw new Error('Expected a validation error.');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('Allowed keys:');
      for (const key of EXCLUDED_KEYS.run.keys()) {
        expect(message).not.toContain(`${key},`);
      }
    }
  });

  it('calls a key excluded on both channels excluded, not cross-channel', () => {
    // `highlight` is a run property, but docDefaults excludes it from the run
    // channel too. Answering "you sent a run property to the paragraph
    // channel" would be technically true and useless: the key is not usable on
    // either channel here, and only the excluded branch carries a reason.
    for (const key of ['highlight', 'rtl', 'cs', 'oMath']) {
      expect(classifyPatchKey(key, 'paragraph', 'docDefaults')).toEqual({
        status: 'excluded',
        reason: EXCLUDED_KEYS.run.get(key)!,
      });
    }
  });

  it('calls the same keys cross-channel under the style scope, where they are usable', () => {
    for (const key of ['highlight', 'rtl', 'cs', 'oMath']) {
      expect(classifyPatchKey(key, 'paragraph', 'style')).toEqual({ status: 'cross_channel', ownerChannel: 'run' });
    }
  });

  it('reports a key excluded on the other channel as excluded, not unknown', () => {
    // Step 4 of the classification. Degrading it to 'unknown' would drop the
    // reason a caller needs to understand the rejection.
    expect(classifyPatchKey('sectPr', 'run', 'docDefaults')).toEqual({ status: 'excluded', reason: 'w:sectPr' });
  });

  it('still excludes revision tracking and self-reference under the style scope', () => {
    expect(classifyPatchKey('rPrChange', 'run', 'style').status).toBe('excluded');
    expect(classifyPatchKey('rStyle', 'run', 'style').status).toBe('excluded');
    expect(classifyPatchKey('pStyle', 'paragraph', 'style').status).toBe('excluded');
  });
});

describe('styles.apply: cross-channel rejection keeps its reason code', () => {
  for (const key of ['highlight', 'rtl', 'cs', 'oMath']) {
    it(`rejects run-only "${key}" on the paragraph channel with excluded_docdefaults_key`, () => {
      const adapter = makeAdapter();
      try {
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'paragraph' },
          patch: { [key]: true } as never,
        });
        throw new Error('Expected a validation error.');
      } catch (err) {
        const e = err as DocumentApiValidationError;
        expect(e.code).toBe('INVALID_INPUT');
        expect(e.message).toContain('docDefaults');
        expect((e as unknown as { details: Record<string, unknown> }).details?.reason).toBe('excluded_docdefaults_key');
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Excluded-key tests
// ---------------------------------------------------------------------------

describe('styles.apply validation: excluded keys', () => {
  for (const [channel, keys] of Object.entries(EXCLUDED_KEYS) as [string, Map<string, string>][]) {
    for (const [key, xmlPath] of keys) {
      it(`rejects excluded key "${key}" on ${channel} with reason 'excluded_docdefaults_key'`, () => {
        const adapter = makeAdapter();
        try {
          executeStylesApply(adapter, {
            target: { scope: 'docDefaults', channel: channel as 'run' | 'paragraph' },
            patch: { [key]: true },
          });
          throw new Error('Expected error');
        } catch (err) {
          expect(err).toBeInstanceOf(DocumentApiValidationError);
          const e = err as DocumentApiValidationError;
          expect(e.code).toBe('INVALID_INPUT');
          expect(e.message).toContain(key);
          expect(e.message).toContain('docDefaults');
          expect((e as unknown as { details: Record<string, unknown> }).details?.reason).toBe(
            'excluded_docdefaults_key',
          );
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Manual edge-case tests
// ---------------------------------------------------------------------------

describe('styles.apply validation: manual edge cases', () => {
  // Integer range boundaries
  it('accepts outlineLvl: 0 (minimum)', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'paragraph' },
        patch: { outlineLvl: 0 },
      }),
    ).not.toThrow();
  });

  it('accepts outlineLvl: 9 (maximum)', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'paragraph' },
        patch: { outlineLvl: 9 },
      }),
    ).not.toThrow();
  });

  it('rejects outlineLvl: 10 (above maximum)', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'paragraph' },
          patch: { outlineLvl: 10 },
        }),
      'INVALID_INPUT',
      /<= 9/,
    );
  });

  it('rejects outlineLvl: -1 (below minimum)', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'paragraph' },
          patch: { outlineLvl: -1 },
        }),
      'INVALID_INPUT',
      />= 0/,
    );
  });

  it('accepts w: 1 (minimum character scaling)', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'run' },
        patch: { w: 1 },
      }),
    ).not.toThrow();
  });

  it('accepts w: 600 (maximum character scaling)', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'run' },
        patch: { w: 600 },
      }),
    ).not.toThrow();
  });

  it('rejects w: 601 (above maximum)', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'run' },
          patch: { w: 601 },
        }),
      'INVALID_INPUT',
      /<= 600/,
    );
  });

  it('rejects w: 0 (below minimum)', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'run' },
          patch: { w: 0 },
        }),
      'INVALID_INPUT',
      />= 1/,
    );
  });

  // underline.val token validation
  it('accepts valid underline.val token', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'run' },
        patch: { underline: { val: 'single' } },
      }),
    ).not.toThrow();
  });

  it('rejects invalid underline.val token', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'run' },
          patch: { underline: { val: 'invalid-style' } },
        }),
      'INVALID_INPUT',
      /must be one of/,
    );
  });

  // tabStops: [] (empty array is legal)
  it('accepts tabStops: [] (empty array clears tab stops)', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'paragraph' },
        patch: { tabStops: [] },
      }),
    ).not.toThrow();
  });

  // tabStops: valid non-empty array
  it('accepts valid tabStops array', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'paragraph' },
        patch: { tabStops: [{ tab: { tabType: 'left', pos: 720 } }] },
      }),
    ).not.toThrow();
  });

  // tabStops: invalid item
  it('rejects tabStops with invalid item structure', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'paragraph' },
          patch: { tabStops: ['invalid'] },
        }),
      'INVALID_INPUT',
    );
  });

  // Nested paragraph borders validation
  it('accepts valid paragraph borders with edge sub-keys', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'paragraph' },
        patch: { borders: { top: { val: 'single', size: 4 } } },
      }),
    ).not.toThrow();
  });

  it('rejects paragraph borders with unknown edge key', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'paragraph' },
          patch: { borders: { invalid: { val: 'single' } } },
        }),
      'INVALID_INPUT',
      /Unknown key/,
    );
  });

  // String property validation
  it('accepts valid effect string', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'run' },
        patch: { effect: 'blinkBackground' },
      }),
    ).not.toThrow();
  });

  it('rejects empty string for effect', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'run' },
          patch: { effect: '' },
        }),
      'INVALID_INPUT',
      /non-empty string/,
    );
  });

  // Mixed-type object sub-keys (eastAsianLayout)
  it('accepts eastAsianLayout with mixed sub-key types', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, {
        target: { scope: 'docDefaults', channel: 'run' },
        patch: { eastAsianLayout: { id: 1, combine: true, vert: false } },
      }),
    ).not.toThrow();
  });

  it('rejects eastAsianLayout with wrong sub-key type', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'run' },
          patch: { eastAsianLayout: { id: 'not-a-number' } },
        }),
      'INVALID_INPUT',
      /finite integer/,
    );
  });
});

describe('styles.apply validation: named style target', () => {
  const styleTarget = { scope: 'style', styleId: 'DemoHeading', channel: 'run' } as const;

  it('passes a style target and its patch through to the adapter unchanged', () => {
    const adapter = makeAdapter();
    const input = { target: styleTarget, patch: { bold: true, fontSize: 28 } };
    executeStylesApply(adapter, input, { dryRun: true });
    expect(adapter.apply).toHaveBeenCalledWith(input, { dryRun: true, expectedRevision: undefined });
  });

  it('accepts null to remove a property, so the style inherits it again', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, { target: styleTarget, patch: { italic: null, color: null, fontFamily: null } }),
    ).not.toThrow();
  });

  it('accepts the run keys only a named style allows', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeStylesApply(adapter, { target: styleTarget, patch: { cs: true, rtl: false, highlight: 'yellow' } }),
    ).not.toThrow();
  });

  it('still validates non-null values against the registry', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesApply(adapter, { target: styleTarget, patch: { bold: 'yes' as never } }),
      'INVALID_INPUT',
      /patch\.bold must be a boolean/,
    );
  });

  it('rejects null on docDefaults, which has nothing to inherit from', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'run' },
          patch: { bold: null as never },
        }),
      'INVALID_INPUT',
      /patch\.bold must be a boolean/,
    );
  });

  it('rejects a missing or empty styleId', () => {
    const adapter = makeAdapter();
    for (const styleId of [undefined, '', 42]) {
      expectValidationError(
        () =>
          executeStylesApply(adapter, {
            target: { scope: 'style', styleId, channel: 'run' } as never,
            patch: { bold: true },
          }),
        'INVALID_TARGET',
        /target\.styleId must be a non-empty string/,
      );
    }
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('rejects the paragraph channel on a named style', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'style', styleId: 'DemoHeading', channel: 'paragraph' } as never,
          patch: { keepNext: true },
        }),
      'INVALID_TARGET',
      /must be "run" for scope "style"/,
    );
  });

  it('rejects styleId on a docDefaults target', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () =>
        executeStylesApply(adapter, {
          target: { scope: 'docDefaults', channel: 'run', styleId: 'DemoHeading' } as never,
          patch: { bold: true },
        }),
      'INVALID_INPUT',
      /Unknown field "target\.styleId"/,
    );
  });

  it('rejects an empty patch on a named style', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesApply(adapter, { target: styleTarget, patch: {} }),
      'INVALID_INPUT',
      /at least one property/,
    );
  });

  it('rejects paragraph keys on a named style run patch', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesApply(adapter, { target: styleTarget, patch: { keepNext: true } as never }),
      'INVALID_INPUT',
      /paragraph-channel property/,
    );
  });
});
