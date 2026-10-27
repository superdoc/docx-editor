import { describe, it, expect, mock } from 'bun:test';
import {
  executeStylesCreate,
  type StylesCreateAdapter,
  type StylesCreateInput,
  type StylesCreateReceipt,
  type NormalizedStylesCreateOptions,
} from './create.js';
import { DocumentApiValidationError } from '../errors.js';
import { STYLE_XML_PATH } from './create.js';
import { STYLE_RUN_XML_PATH } from './apply.js';
import { XML_PATH_BY_CHANNEL } from './registry.js';
import { buildInternalContractSchemas } from '../contract/schemas.js';

type JsonSchemaNode = Record<string, unknown> & {
  oneOf?: unknown;
  properties?: unknown;
  enum?: unknown;
  const?: unknown;
};

function okReceipt(dryRun: boolean): StylesCreateReceipt {
  return {
    success: true,
    changed: true,
    created: true,
    resolution: {
      scope: 'style',
      id: 'Kushya',
      type: 'paragraph',
      xmlPart: 'word/styles.xml',
      xmlPath: 'w:styles/w:style',
    },
    dryRun,
    before: null,
    after: { paragraph: {}, run: {} },
  };
}

function makeAdapter(): StylesCreateAdapter & { create: ReturnType<typeof mock> } {
  return {
    create: mock((_input: StylesCreateInput, options: NormalizedStylesCreateOptions) => okReceipt(options.dryRun)),
  };
}

const MINIMAL: StylesCreateInput = { id: 'Kushya', name: 'Kushya', type: 'paragraph' };

function expectValidationError(fn: () => unknown, code: string, messagePattern?: RegExp): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DocumentApiValidationError);
    const e = err as DocumentApiValidationError;
    expect(e.code).toBe(code);
    if (messagePattern) expect(e.message).toMatch(messagePattern);
    return;
  }
  throw new Error(`Expected ${code} to be thrown.`);
}

describe('executeStylesCreate contract', () => {
  it('routes a valid definition to the adapter with normalized options', () => {
    const adapter = makeAdapter();
    const receipt = executeStylesCreate(adapter, MINIMAL, { expectedRevision: '7' });

    expect(adapter.create).toHaveBeenCalledTimes(1);
    const [input, options] = adapter.create.mock.calls[0];
    expect(input).toEqual(MINIMAL);
    expect(options).toEqual({ dryRun: false, expectedRevision: '7' });
    expect(receipt.success).toBe(true);
  });

  it('defaults dryRun to false and leaves expectedRevision undefined', () => {
    const adapter = makeAdapter();
    executeStylesCreate(adapter, MINIMAL);
    expect(adapter.create.mock.calls[0][1]).toEqual({ dryRun: false, expectedRevision: undefined });
  });

  it('passes dryRun through to the adapter and back on the receipt', () => {
    const adapter = makeAdapter();
    const receipt = executeStylesCreate(adapter, MINIMAL, { dryRun: true });
    expect(adapter.create.mock.calls[0][1].dryRun).toBe(true);
    expect(receipt.success && receipt.dryRun).toBe(true);
  });

  it('accepts every optional field on a paragraph style', () => {
    const adapter = makeAdapter();
    executeStylesCreate(adapter, {
      id: 'Kushya',
      name: 'Kushya',
      type: 'paragraph',
      basedOn: 'Normal',
      next: 'Terutz',
      aliases: ['Question'],
      priority: 21,
      qFormat: true,
      hidden: false,
      semiHidden: false,
      unhideWhenUsed: true,
      locked: false,
      custom: true,
      conflictPolicy: 'replace',
      paragraph: { keepNext: true, rightToLeft: true },
      run: { bold: true, rtl: true, cs: true, highlight: 'yellow' },
    });
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });

  it('accepts basedOn: null as an explicit "based on nothing"', () => {
    const adapter = makeAdapter();
    executeStylesCreate(adapter, { ...MINIMAL, basedOn: null });
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });

  it('accepts a next that names the style being created', () => {
    const adapter = makeAdapter();
    executeStylesCreate(adapter, { id: 'Kushya', name: 'Kushya', type: 'paragraph', next: 'Kushya' });
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });
});

describe('executeStylesCreate: capability', () => {
  it('fails closed when the engine provides no create hook', () => {
    expectValidationError(() => executeStylesCreate({}, MINIMAL), 'CAPABILITY_UNAVAILABLE', /styles\.create/);
    expectValidationError(() => executeStylesCreate(undefined, MINIMAL), 'CAPABILITY_UNAVAILABLE');
    // A host that supplies the key with the wrong type must still fail closed
    // rather than crash: failing closed is this operation's whole behaviour today.
    expectValidationError(() => executeStylesCreate({ create: 'x' } as never, MINIMAL), 'CAPABILITY_UNAVAILABLE');
  });

  it('validates input before reporting the capability as unavailable', () => {
    // A malformed call must be reported as malformed. Reversing these would
    // tell a caller to change runtime when the fix is to change the argument.
    expectValidationError(() => executeStylesCreate({}, { id: '', name: 'x', type: 'paragraph' }), 'INVALID_INPUT');
  });
});

describe('executeStylesCreate validation: identity', () => {
  it('rejects a non-object input', () => {
    const adapter = makeAdapter();
    expectValidationError(() => executeStylesCreate(adapter, null as never), 'INVALID_INPUT');
    expectValidationError(() => executeStylesCreate(adapter, 'Kushya' as never), 'INVALID_INPUT');
  });

  it('rejects an unknown field by name', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, styleId: 'Kushya' } as never),
      'INVALID_INPUT',
      /styleId/,
    );
  });

  it('rejects a missing or empty id and name', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { name: 'x', type: 'paragraph' } as never),
      'INVALID_INPUT',
      /id/,
    );
    expectValidationError(() => executeStylesCreate(adapter, { ...MINIMAL, id: '' }), 'INVALID_INPUT', /id/);
    expectValidationError(() => executeStylesCreate(adapter, { ...MINIMAL, name: '' }), 'INVALID_INPUT', /name/);
  });

  it('accepts an id containing a space, as setStyleRef does', () => {
    // w:styleId is an ST_String and real documents carry ids with spaces. A
    // stricter rule here would let setStyleRef apply a style this cannot author.
    const adapter = makeAdapter();
    executeStylesCreate(adapter, { id: 'Body Text', name: 'Body Text', type: 'paragraph' });
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a type outside paragraph | character', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, type: 'table' } as never),
      'INVALID_INPUT',
      /type/,
    );
  });

  it('rejects a non-integer or non-null priority', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, priority: 1.5 }),
      'INVALID_INPUT',
      /priority/,
    );
    expectValidationError(() => executeStylesCreate(adapter, { ...MINIMAL, priority: '1' as never }), 'INVALID_INPUT');
  });

  it('accepts a priority outside Word’s 0..99 UI band, and null', () => {
    // w:uiPriority is an ST_DecimalNumber; the catalogue reads it back as
    // `number | null`. Capping it here would reject what getCatalog returns.
    const adapter = makeAdapter();
    executeStylesCreate(adapter, { ...MINIMAL, priority: 4000 });
    executeStylesCreate(adapter, { ...MINIMAL, priority: null });
    expect(adapter.create).toHaveBeenCalledTimes(2);
  });

  // Driven off the constant so the assertion cannot drift from it: pinning one
  // flag made the whole loop look covered while five of its six were not.
  for (const flag of ['qFormat', 'hidden', 'semiHidden', 'unhideWhenUsed', 'locked', 'custom'] as const) {
    it(`rejects a non-boolean ${flag}`, () => {
      const adapter = makeAdapter();
      expectValidationError(
        () => executeStylesCreate(adapter, { ...MINIMAL, [flag]: 'yes' } as never),
        'INVALID_INPUT',
        new RegExp(flag),
      );
    });
  }

  it('rejects a non-string or empty basedOn', () => {
    const adapter = makeAdapter();
    expectValidationError(() => executeStylesCreate(adapter, { ...MINIMAL, basedOn: '' }), 'INVALID_INPUT', /basedOn/);
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, basedOn: 123 as never }),
      'INVALID_INPUT',
      /basedOn/,
    );
  });

  it('rejects an empty or non-string next', () => {
    const adapter = makeAdapter();
    expectValidationError(() => executeStylesCreate(adapter, { ...MINIMAL, next: '' }), 'INVALID_INPUT', /next/);
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, next: 5 as never }),
      'INVALID_INPUT',
      /next/,
    );
  });

  it('rejects a conflictPolicy outside fail | replace', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, conflictPolicy: 'merge' as never }),
      'INVALID_INPUT',
      /conflictPolicy/,
    );
  });
});

describe('executeStylesCreate validation: aliases', () => {
  it('rejects a non-array', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, aliases: 'Question' as never }),
      'INVALID_INPUT',
    );
  });

  it('rejects an empty alias', () => {
    const adapter = makeAdapter();
    expectValidationError(() => executeStylesCreate(adapter, { ...MINIMAL, aliases: [''] }), 'INVALID_INPUT');
  });

  it('rejects an alias containing a comma', () => {
    // w:aliases is one comma-delimited value, so this would read back as two.
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, aliases: ['Question, Answer'] }),
      'INVALID_INPUT',
      /comma/,
    );
  });

  it('rejects a duplicate alias', () => {
    const adapter = makeAdapter();
    expectValidationError(() => executeStylesCreate(adapter, { ...MINIMAL, aliases: ['Q', 'Q'] }), 'INVALID_INPUT');
  });

  it('accepts an alias equal to the style name', () => {
    // Redundant, not corrupting — and JSON Schema cannot compare sibling
    // fields, so rejecting it here would put the validator and the published
    // schema into disagreement over an input that harms nothing.
    const adapter = makeAdapter();
    executeStylesCreate(adapter, { ...MINIMAL, aliases: ['Kushya'] });
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });
});

describe('executeStylesCreate validation: character styles carry no paragraph surface', () => {
  const CHAR: StylesCreateInput = { id: 'Emphasis2', name: 'Emphasis 2', type: 'character' };

  it('accepts run properties', () => {
    const adapter = makeAdapter();
    executeStylesCreate(adapter, { ...CHAR, run: { bold: true, rtl: true } });
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });

  it('rejects next', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...CHAR, next: 'Normal' } as never),
      'INVALID_INPUT',
      /next/,
    );
  });

  it('rejects paragraph properties', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...CHAR, paragraph: { keepNext: true } } as never),
      'INVALID_INPUT',
      /paragraph/,
    );
  });
});

describe('executeStylesCreate validation: patch surface', () => {
  it('accepts the four run properties docDefaults forbids', () => {
    // The whole point of the `style` scope: a right-to-left style is not
    // expressible without w:rtl.
    const adapter = makeAdapter();
    executeStylesCreate(adapter, { ...MINIMAL, run: { rtl: true, cs: true, oMath: false, highlight: 'cyan' } });
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });

  it('rejects null, which only styles.apply on a named style accepts', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, run: { bold: null } as never }),
      'INVALID_INPUT',
      /run\.bold must be a boolean/,
    );
  });

  it('still rejects revision-tracking and self-referential keys', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, run: { rPrChange: {} } as never }),
      'INVALID_INPUT',
    );
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, paragraph: { pStyle: 'Normal' } as never }),
      'INVALID_INPUT',
    );
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, paragraph: { sectPr: {} } as never }),
      'INVALID_INPUT',
    );
  });

  it('names the offending field as run or paragraph, not as patch', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, run: { nope: true } as never }),
      'INVALID_INPUT',
      /^Unknown run key/,
    );
    // The "Allowed keys" list is scope-filtered, so it must not offer a key
    // this scope would then reject.
    try {
      executeStylesCreate(adapter, { ...MINIMAL, run: { nope: true } as never });
    } catch (err) {
      expect((err as Error).message).not.toContain('rStyle');
    }
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, paragraph: { nope: true } as never }),
      'INVALID_INPUT',
      /^Unknown paragraph key/,
    );
  });

  it('reports a cross-channel key against the channel that owns it', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, run: { keepNext: true } as never }),
      'INVALID_INPUT',
      /paragraph-channel property/,
    );
  });

  it('validates patch values against the registry schema', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, run: { bold: 'yes' as never } }),
      'INVALID_INPUT',
    );
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, paragraph: { outlineLvl: 'one' as never } }),
      'INVALID_INPUT',
    );
  });

  it('rejects an empty patch object on either channel', () => {
    // The published schema says minProperties: 1. A caller pre-validating
    // against the contract would reject what the library accepted.
    const adapter = makeAdapter();
    expectValidationError(() => executeStylesCreate(adapter, { ...MINIMAL, run: {} }), 'INVALID_INPUT', /run/);
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, paragraph: {} }),
      'INVALID_INPUT',
      /paragraph/,
    );
  });

  it('rejects a highlight value outside ST_HighlightColor', () => {
    // A free string here writes an invalid w:highlight into styles.xml, which
    // Word reports as a damaged document rather than as a rejected call.
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, run: { highlight: '#FFFF00' as never } }),
      'INVALID_INPUT',
    );
    expectValidationError(
      () => executeStylesCreate(adapter, { ...MINIMAL, run: { highlight: 'purple' as never } }),
      'INVALID_INPUT',
    );
    executeStylesCreate(adapter, { ...MINIMAL, run: { highlight: 'yellow' } });
    expect(adapter.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-object patch on either channel', () => {
    // Without the guard these reach Object.keys(null) and throw a raw
    // TypeError across the API boundary instead of a validation error.
    const adapter = makeAdapter();
    for (const bad of [null, 'x', []] as never[]) {
      expectValidationError(() => executeStylesCreate(adapter, { ...MINIMAL, run: bad }), 'INVALID_INPUT');
      expectValidationError(() => executeStylesCreate(adapter, { ...MINIMAL, paragraph: bad }), 'INVALID_INPUT');
    }
  });

  it('reports an excluded key against the style scope, not against docDefaults', () => {
    // The message names the destination. Saying "docDefaults" here would tell
    // the caller they violated a restriction that does not apply to them.
    const adapter = makeAdapter();
    try {
      executeStylesCreate(adapter, { ...MINIMAL, run: { rStyle: 'Emphasis' } as never });
      throw new Error('Expected a validation error.');
    } catch (err) {
      const e = err as DocumentApiValidationError;
      expect(e.code).toBe('INVALID_INPUT');
      expect(e.message).toContain('a named Word style');
      expect(e.message).not.toContain('docDefaults');
      expect((e as unknown as { details: Record<string, unknown> }).details?.reason).toBe('excluded_style_key');
    }
  });
});

describe('executeStylesCreate validation: options', () => {
  it('rejects an unknown options key', () => {
    const adapter = makeAdapter();
    expectValidationError(
      () => executeStylesCreate(adapter, MINIMAL, { force: true } as never),
      'INVALID_INPUT',
      /force/,
    );
  });

  it('rejects a non-boolean dryRun and a non-string expectedRevision', () => {
    const adapter = makeAdapter();
    expectValidationError(() => executeStylesCreate(adapter, MINIMAL, { dryRun: 'yes' as never }), 'INVALID_INPUT');
    expectValidationError(
      () => executeStylesCreate(adapter, MINIMAL, { expectedRevision: 7 as never }),
      'INVALID_INPUT',
    );
  });

  it('rejects options before reaching the adapter', () => {
    const adapter = makeAdapter();
    expectValidationError(() => executeStylesCreate(adapter, MINIMAL, { force: true } as never), 'INVALID_INPUT');
    expect(adapter.create).not.toHaveBeenCalled();
  });
});

/**
 * `schemas.ts` writes its XML paths as literals rather than referencing the
 * exported constants — `styles.apply` does the same two entries above this one.
 * That is deliberate for a published wire format: a schema that follows a
 * constant changes the contract whenever the constant moves, silently. What it
 * must not do is drift from the type, and `StylesCreateResolution.xmlPath` is
 * pinned to `STYLE_XML_PATH`, so this asserts the two still agree.
 */
describe('published xmlPath matches the exported constant', () => {
  const schemas = buildInternalContractSchemas().operations;

  function resolutionProperties(operationId: 'styles.create' | 'styles.apply'): Record<string, JsonSchemaNode> {
    const output = schemas[operationId].output as JsonSchemaNode;
    const success = (output.oneOf as JsonSchemaNode[])[0];
    const resolution = (success.properties as Record<string, JsonSchemaNode>).resolution;
    const variant = resolution.oneOf ? (resolution.oneOf as JsonSchemaNode[])[0] : resolution;
    return variant.properties as Record<string, JsonSchemaNode>;
  }

  it('pins styles.create to STYLE_XML_PATH', () => {
    expect(resolutionProperties('styles.create').xmlPath.const).toBe(STYLE_XML_PATH);
  });

  it('pins styles.apply to XML_PATH_BY_CHANNEL, which the same file spells out', () => {
    const published = resolutionProperties('styles.apply').xmlPath.enum as string[];

    expect([...published].sort()).toEqual([XML_PATH_BY_CHANNEL.run, XML_PATH_BY_CHANNEL.paragraph].sort());
  });

  it('pins the styles.apply named-style resolution to STYLE_RUN_XML_PATH', () => {
    const output = schemas['styles.apply'].output as JsonSchemaNode;
    const success = (output.oneOf as JsonSchemaNode[])[0];
    const resolution = (success.properties as Record<string, JsonSchemaNode>).resolution;
    const properties = (resolution.oneOf as JsonSchemaNode[])[1].properties as Record<string, JsonSchemaNode>;

    expect(properties.scope.const).toBe('style');
    expect(properties.xmlPath.const).toBe(STYLE_RUN_XML_PATH);
  });
});
