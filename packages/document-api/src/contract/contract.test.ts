import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { expectJsonRecording, recordingPath } from '../../../sdk/test-support/recording.ts';
import { COMMAND_CATALOG, OPERATION_DESCRIPTION_MAP, OPERATION_EXPECTED_RESULT_MAP } from './command-catalog.js';
import { OPERATION_DEFINITIONS } from './operation-definitions.js';
import { DOCUMENT_API_MEMBER_PATHS } from './operation-map.js';
import { OPERATION_REFERENCE_DOC_PATH_MAP, REFERENCE_OPERATION_GROUPS } from './reference-doc-map.js';
import { buildInternalContractSchemas } from './schemas.js';
import { PUBLIC_MUTATION_STEP_OP_IDS, STEP_OP_CATALOG } from './step-op-catalog.js';
import { OPERATION_IDS, PRE_APPLY_THROW_CODES, isValidOperationIdFormat } from './types.js';
import type { TemplatesApplyFailureCode } from '../templates/index.js';
import type { ReceiptFailureCode } from '../types/index.js';
import { executeBlocksDelete, executeBlocksMove } from '../blocks/blocks.js';
import type { BlocksDeleteResult, BlocksMoveResult } from '../types/blocks.types.js';
import type { TrackChangeTarget } from '../types/track-changes.types.js';
import type { CommentTrackedChangeLink } from '../comments/comments.types.js';

const TRACK_CHANGES_DECIDE_RECEIPT_FAILURE_CODES = [
  'NO_OP',
  'INVALID_INPUT',
  'INVALID_TARGET',
  'TARGET_NOT_FOUND',
  'CAPABILITY_UNAVAILABLE',
  'PERMISSION_DENIED',
  'PRECONDITION_FAILED',
  'COMMENT_CASCADE_PARTIAL',
] as const satisfies readonly ReceiptFailureCode[];

// Every TemplatesApplyFailureCode that the adapter can surface in a returned
// { success: false, failure } receipt. The satisfies guard below fails to
// compile if the contract's failure-code union and this list ever diverge.
const TEMPLATES_APPLY_RECEIPT_FAILURE_CODES = [
  'UNSUPPORTED_SOURCE',
  'INVALID_PACKAGE',
  'CAPABILITY_UNAVAILABLE',
  'UNSUPPORTED_TEMPLATE_CONTENT',
] as const satisfies readonly TemplatesApplyFailureCode[];

// Exhaustiveness: assigning the union to the array's element type (and vice
// versa) guarantees the list above covers every TemplatesApplyFailureCode value.
type _TemplatesFailureCoverageForward =
  TemplatesApplyFailureCode extends (typeof TEMPLATES_APPLY_RECEIPT_FAILURE_CODES)[number] ? true : never;
const _templatesFailureCoverage: _TemplatesFailureCoverageForward = true;
void _templatesFailureCoverage;

function expectArrayToIncludeValues(
  actual: readonly string[] | undefined,
  expected: readonly string[],
  label: string,
): void {
  expect(Array.isArray(actual), `${label} should be an array`).toBe(true);
  const missing = expected.filter((code) => !actual!.includes(code));
  expect(missing, `${label} missing expected codes`).toEqual([]);
}

type ContractTestSchemaShape = {
  $ref?: string;
  additionalProperties?: boolean;
  minItems?: number;
  pattern?: string;
  required?: string[];
  properties?: Record<string, ContractTestSchemaShape>;
  items?: ContractTestSchemaShape;
  oneOf?: ContractTestSchemaShape[];
  const?: unknown;
  enum?: unknown[];
  type?: string;
};

function collectUnknownPropertySchemaErrors(
  schema: ContractTestSchemaShape | undefined,
  value: unknown,
  path = '$',
): string[] {
  if (!schema) return [`${path}: missing schema`];
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, index) => collectUnknownPropertySchemaErrors(schema.items, item, `${path}[${index}]`));
  }
  if (schema.type !== 'object' || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const properties = schema.properties ?? {};
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    const childPath = `${path}.${key}`;
    const propertySchema = properties[key];
    if (!propertySchema) {
      if (schema.additionalProperties === false) {
        errors.push(`${childPath}: unknown property`);
      }
      continue;
    }
    errors.push(
      ...collectUnknownPropertySchemaErrors(propertySchema, (value as Record<string, unknown>)[key], childPath),
    );
  }
  return errors;
}

const recording = (scenario: string) => recordingPath(import.meta.dir, 'contract-schema', scenario);

function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, withSortedKeys(nested)]),
  );
}

function expectContractRecording(value: unknown, scenario: string): void {
  expectJsonRecording(withSortedKeys(value), recording(scenario));
}

describe('document-api contract schema recording', () => {
  const schemas = buildInternalContractSchemas();
  const defs = schemas.$defs ?? {};

  it('records the schema dialect, contract version, operation ids and shared definition names', () => {
    expectContractRecording(
      {
        $schema: schemas.$schema,
        contractVersion: schemas.contractVersion,
        operations: OPERATION_IDS,
        $defs: Object.keys(defs),
      },
      'index',
    );
  });

  it.each([...OPERATION_IDS])('records the %s definition and schemas', (operationId) => {
    expectContractRecording(
      { definition: OPERATION_DEFINITIONS[operationId], schemas: schemas.operations[operationId] },
      `operations/${operationId}`,
    );
  });

  it.each(Object.keys(defs))('records the shared %s definition', (name) => {
    expectContractRecording(defs[name], `defs/${name}`);
  });

  it('describes optional resolver attribution on comment reads and patch receipts', () => {
    const fields = {
      resolvedTime: { type: 'number' },
      resolvedById: { type: 'string' },
      resolvedByEmail: { type: 'string' },
      resolvedByName: { type: 'string' },
    };
    expect(schemas.operations['comments.get'].output).toMatchObject({
      additionalProperties: false,
      properties: fields,
    });
    expect(schemas.operations['comments.list'].output).toMatchObject({
      properties: { items: { items: { additionalProperties: false, properties: fields } } },
    });
    expect(schemas.operations['comments.patch'].success).toMatchObject({
      additionalProperties: false,
      properties: fields,
    });
    expect(defs.ReceiptSuccess).not.toMatchObject({ properties: fields });
  });

  it('keeps no recording for a removed operation or shared definition', () => {
    const recorded = (folder: string) =>
      readdirSync(path.dirname(recording(`${folder}/any`)))
        .map((file) => path.basename(file, '.txt'))
        .sort();
    expect(recorded('operations'), 'delete the recordings of removed operations').toEqual([...OPERATION_IDS].sort());
    expect(recorded('defs'), 'delete the recordings of removed shared definitions').toEqual(Object.keys(defs).sort());
  });
});

describe('document-api contract catalog', () => {
  it('keeps operation ids explicit and format-valid', () => {
    expect([...new Set(OPERATION_IDS)]).toHaveLength(OPERATION_IDS.length);
    for (const operationId of OPERATION_IDS) {
      expect(isValidOperationIdFormat(operationId)).toBe(true);
    }
  });

  it('derives member paths from operation ids with no duplicates', () => {
    expect(new Set(DOCUMENT_API_MEMBER_PATHS).size).toBe(DOCUMENT_API_MEMBER_PATHS.length);
  });

  it('lists every operation in exactly one reference group', () => {
    const grouped = REFERENCE_OPERATION_GROUPS.flatMap((group) => group.operations);
    expect(grouped).toHaveLength(OPERATION_IDS.length);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...OPERATION_IDS].sort());
  });

  it('accepts every diff.compare blocker code and part change as diff.apply input', () => {
    const operations = buildInternalContractSchemas().operations;
    const compareOutput = operations['diff.compare'].output as ContractTestSchemaShape;
    const applyInput = operations['diff.apply'].input as ContractTestSchemaShape;
    const compareCodes =
      compareOutput.properties?.applyEligibility?.properties?.tracked?.properties?.blockers?.items?.properties?.code
        ?.enum;
    const applyCodes =
      applyInput.properties?.diff?.properties?.applyEligibility?.properties?.tracked?.properties?.blockers?.items
        ?.properties?.code?.enum;

    expect(applyCodes).toEqual(compareCodes);
    expect(applyInput.properties?.diff?.properties?.partChanges).toEqual(compareOutput.properties?.partChanges);
  });

  it('enforces typed throw and post-apply policy metadata for mutation operations', () => {
    const validPreApplyThrowCodes = new Set(PRE_APPLY_THROW_CODES);

    for (const operationId of OPERATION_IDS) {
      const metadata = COMMAND_CATALOG[operationId];
      for (const throwCode of metadata.throws.preApply) {
        expect(validPreApplyThrowCodes.has(throwCode)).toBe(true);
      }

      if (!metadata.mutates) continue;
      expect(metadata.throws.postApplyForbidden).toBe(true);
    }
  });

  it('includes CAPABILITY_UNAVAILABLE in throws.preApply for all mutation operations', () => {
    for (const operationId of OPERATION_IDS) {
      const metadata = COMMAND_CATALOG[operationId];
      if (!metadata.mutates) continue;
      expect(
        metadata.throws.preApply,
        `${operationId} should include CAPABILITY_UNAVAILABLE in throws.preApply`,
      ).toContain('CAPABILITY_UNAVAILABLE');
    }
  });

  it('declares CAPABILITY_UNAVAILABLE as a receipt failure for every mutation that returns receipts', () => {
    const temporaryMutations = [
      'mutations.beginTemporary',
      'mutations.replaceTemporary',
      'mutations.rollbackTemporary',
      'mutations.commitTemporary',
    ];
    const undeclared = OPERATION_IDS.filter(
      (operationId) =>
        COMMAND_CATALOG[operationId].mutates &&
        !temporaryMutations.includes(operationId) &&
        !COMMAND_CATALOG[operationId].possibleFailureCodes.includes('CAPABILITY_UNAVAILABLE'),
    );
    expect(undeclared).toEqual([]);
    for (const operationId of [
      'tables.move',
      'citations.bibliography.insert',
      'footnotes.configure',
      'blocks.delete',
    ] as const) {
      expect(COMMAND_CATALOG[operationId].possibleFailureCodes, operationId).toContain('CAPABILITY_UNAVAILABLE');
    }
  });

  it('publishes a receipt failure schema that accepts CAPABILITY_UNAVAILABLE wherever it is declared', () => {
    const schemas = buildInternalContractSchemas();
    for (const operationId of OPERATION_IDS) {
      if (!COMMAND_CATALOG[operationId].possibleFailureCodes.includes('CAPABILITY_UNAVAILABLE')) continue;
      const failure = schemas.operations[operationId].failure as ContractTestSchemaShape | undefined;
      const codes = failure?.properties?.failure?.properties?.code?.enum;
      if (codes) expect(codes, operationId).toContain('CAPABILITY_UNAVAILABLE');
    }
  });

  it('keeps input schemas closed for object-shaped payloads', () => {
    const schemas = buildInternalContractSchemas();

    for (const operationId of OPERATION_IDS) {
      const inputSchema = schemas.operations[operationId].input as { type?: string; additionalProperties?: unknown };
      if (inputSchema.type !== 'object') continue;
      expect(inputSchema.additionalProperties).toBe(false);
    }
  });

  it.each([
    'mutations.beginTemporary',
    'mutations.replaceTemporary',
    'mutations.rollbackTemporary',
    'mutations.commitTemporary',
  ] as const)('describes %s thrown failures without widening its success-only output', (operationId) => {
    const operation = buildInternalContractSchemas().operations[operationId];
    const output = operation.output as ContractTestSchemaShape;
    const failure = operation.failure as ContractTestSchemaShape | undefined;
    expect(output).toEqual(operation.success);
    expect(output.properties?.success).toEqual({ const: true });
    expect(output.oneOf).toBeUndefined();
    expect(COMMAND_CATALOG[operationId].possibleFailureCodes).toEqual([]);
    expect(failure?.required).toEqual(['success', 'failure']);
    expect(failure?.properties?.success).toEqual({ const: false });
    expect(failure?.properties?.failure?.properties?.code?.enum).toEqual([
      ...COMMAND_CATALOG[operationId].throws.preApply,
    ]);
  });

  it('accepts a list mutation receipt on lists.continuePrevious success', () => {
    const outputSchema = buildInternalContractSchemas().operations['lists.continuePrevious']
      .output as ContractTestSchemaShape;
    const successSchema = outputSchema.oneOf?.find((schema) => schema.properties?.success?.const === true);

    expect(
      collectUnknownPropertySchemaErrors(successSchema, {
        success: true,
        item: { kind: 'block', nodeType: 'listItem', nodeId: 'LIST0001' },
        affectedStories: [{ kind: 'story', storyType: 'body' }],
        txId: 'lists.continuePrevious-1',
        changed: true,
      }),
    ).toEqual([]);
  });

  it('gives htmlToFragment its own reference page', () => {
    expect(
      Object.entries(OPERATION_REFERENCE_DOC_PATH_MAP).filter(([, path]) => path === 'html-to-fragment.mdx'),
    ).toEqual([['htmlToFragment', 'html-to-fragment.mdx']]);
  });

  it('allows every canonical Word highlight in converted fragments', () => {
    const defs = buildInternalContractSchemas().$defs as Record<string, ContractTestSchemaShape>;
    expect(defs.SDInboundRunProps?.properties?.highlight).toEqual({
      enum: [
        'black',
        'blue',
        'cyan',
        'green',
        'magenta',
        'red',
        'yellow',
        'white',
        'darkBlue',
        'darkCyan',
        'darkGreen',
        'darkMagenta',
        'darkRed',
        'darkYellow',
        'darkGray',
        'lightGray',
        'none',
      ],
    });
  });

  it('keeps every inbound fragment object closed', () => {
    const defs = buildInternalContractSchemas().$defs as Record<string, ContractTestSchemaShape>;

    for (const [name, schema] of Object.entries(defs)) {
      if (!name.startsWith('SDInbound') || schema.type !== 'object') continue;
      expect(schema.additionalProperties, `${name} must stay closed`).toBe(false);
    }
  });

  it('keeps insert and replace failure branches closed and identity-free', () => {
    const schemas = buildInternalContractSchemas();
    for (const operationId of ['insert', 'replace'] as const) {
      const failure = schemas.operations[operationId].failure as ContractTestSchemaShape;
      expect(failure.additionalProperties).toBe(false);
      for (const field of ['id', 'inserted', 'effects', 'txId']) expect(failure.properties).not.toHaveProperty(field);
    }
  });

  it('retains declared tracked comment link metadata while rejecting unknown link fields', () => {
    const schemas = buildInternalContractSchemas();
    const schema = schemas.$defs?.CommentTrackedChangeLink as ContractTestSchemaShape;
    const link = {
      trackedChange: true,
      trackedChangeId: 'tracked-policy-1',
      trackedChangeType: 'insertion',
      side: 'inserted',
      trackedChangeText: 'Tracked policy marker.',
      trackedChangeDisplayType: 'insertion',
      trackedChangeStory: { kind: 'story', storyType: 'body' },
      trackedChangeAnchorKey: 'tracked-policy-1',
    } satisfies CommentTrackedChangeLink;
    expect(collectUnknownPropertySchemaErrors(schema, link)).toEqual([]);
    expect(
      collectUnknownPropertySchemaErrors(schema, {
        ...link,
        trackedChangeDisplayType: null,
        trackedChangeStory: null,
        trackedChangeAnchorKey: null,
      }),
    ).toEqual([]);
    expect(collectUnknownPropertySchemaErrors(schema, { ...link, unsupportedLinkMetadata: 'must reject' })).toEqual([
      '$.unsupportedLinkMetadata: unknown property',
    ]);
  });

  it('accepts the complete retained native comment and tracked-change read inventory', () => {
    const schemas = buildInternalContractSchemas();
    const rows = JSON.parse(
      readFileSync(new URL('../../../sdk/langs/rust/tests/fixtures/native-results.json', import.meta.url), 'utf8'),
    ) as Array<{ mode: string; operationId: string; stage: string; value: unknown }>;
    const readFamilies = ['doc.comments.list', 'doc.comments.get', 'doc.trackChanges.list', 'doc.trackChanges.get'];
    const reads = rows.filter(({ operationId }) => readFamilies.includes(operationId));
    const expected = ['cli', 'document'].flatMap((mode) => [
      ...readFamilies.map((operationId) => `${mode}:${operationId}:live`),
      `${mode}:doc.comments.list:saved`,
    ]);
    expect(reads.map(({ mode, operationId, stage }) => `${mode}:${operationId}:${stage}`).sort()).toEqual(
      expected.sort(),
    );
    for (const row of reads) {
      const operation = schemas.operations[row.operationId.slice(4) as keyof typeof schemas.operations];
      expect(
        collectUnknownPropertySchemaErrors(operation.output as ContractTestSchemaShape, row.value),
        row.operationId,
      ).toEqual([]);
    }
  });

  it('accepts native comment receipt metadata while requiring the generated id', () => {
    const schemas = buildInternalContractSchemas();
    const defs = schemas.$defs as Record<string, ContractTestSchemaShape>;
    const success = defs.CommentsCreateSuccess;
    const nativeReceipt = {
      success: true,
      id: 'synthetic-comment',
      inserted: [{ kind: 'comment', commentId: 'synthetic-comment' }],
      affectedStories: [{ kind: 'story', storyType: 'body' }],
      txId: 'synthetic-comment-create',
    };
    expect(collectUnknownPropertySchemaErrors(success, nativeReceipt)).toEqual([]);
    expect(Object.keys(success.properties!).sort()).toEqual(Object.keys(defs.ReceiptSuccess.properties!).sort());
    expect(success.additionalProperties).toBe(false);
    expect(success.required).toEqual(expect.arrayContaining(['success', 'id']));
  });

  it('declares every trackChanges.decide receipt failure code in command metadata', () => {
    expectArrayToIncludeValues(
      COMMAND_CATALOG['trackChanges.decide'].possibleFailureCodes,
      TRACK_CHANGES_DECIDE_RECEIPT_FAILURE_CODES,
      'trackChanges.decide possibleFailureCodes',
    );
  });

  it('declares named numbering no-op and capability failures in metadata and schemas', () => {
    const codes = ['CAPABILITY_UNAVAILABLE', 'NO_OP'];
    const schemas = buildInternalContractSchemas();
    for (const operationId of [
      'lists.setLevelNumberStyle',
      'lists.setLevelText',
      'lists.setLevelStart',
      'lists.setLevelLayout',
      'lists.applyStyle',
    ] as const) {
      expect(OPERATION_EXPECTED_RESULT_MAP[operationId]).toContain('changed: false');
      expect(OPERATION_DESCRIPTION_MAP[operationId]).toContain('CAPABILITY_UNAVAILABLE');
      expect(OPERATION_DESCRIPTION_MAP[operationId]).not.toContain('clon');
      expectArrayToIncludeValues(
        COMMAND_CATALOG[operationId].possibleFailureCodes,
        codes,
        `${operationId} possibleFailureCodes`,
      );
      const schema = schemas.operations[operationId].failure as ContractTestSchemaShape;
      expectArrayToIncludeValues(
        schema.properties?.failure?.properties?.code?.enum as string[] | undefined,
        codes,
        `${operationId} failure schema enum`,
      );
    }
  });

  it('declares every templates.apply receipt failure code in command metadata', () => {
    expectArrayToIncludeValues(
      COMMAND_CATALOG['templates.apply'].possibleFailureCodes,
      TEMPLATES_APPLY_RECEIPT_FAILURE_CODES,
      'templates.apply possibleFailureCodes',
    );
    // The contract must not over-declare codes the adapter cannot produce.
    const declared = [...(COMMAND_CATALOG['templates.apply'].possibleFailureCodes ?? [])].sort();
    expect(declared).toEqual([...TEMPLATES_APPLY_RECEIPT_FAILURE_CODES].sort());
  });

  it('includes every templates.apply receipt failure code in the generated failure schema', () => {
    const schemas = buildInternalContractSchemas();
    const templatesFailureSchema = schemas.operations['templates.apply'].failure as {
      properties?: {
        failure?: {
          properties?: {
            code?: {
              enum?: string[];
            };
          };
        };
      };
    };
    const enumCodes = templatesFailureSchema.properties?.failure?.properties?.code?.enum;
    expectArrayToIncludeValues(enumCodes, TEMPLATES_APPLY_RECEIPT_FAILURE_CODES, 'templates.apply failure schema enum');
  });

  it('includes every trackChanges.decide receipt failure code in the generated failure schema', () => {
    const schemas = buildInternalContractSchemas();
    const decideFailureSchema = schemas.operations['trackChanges.decide'].failure as {
      properties?: {
        failure?: {
          properties?: {
            code?: {
              enum?: string[];
            };
          };
        };
      };
    };

    expectArrayToIncludeValues(
      decideFailureSchema.properties?.failure?.properties?.code?.enum,
      TRACK_CHANGES_DECIDE_RECEIPT_FAILURE_CODES,
      'trackChanges.decide failure schema code enum',
    );
  });

  it('includes every trackChanges.decide receipt failure code in the generated output schema', () => {
    const schemas = buildInternalContractSchemas();
    const decideOutputSchema = schemas.operations['trackChanges.decide'].output as {
      oneOf?: Array<{
        properties?: {
          failure?: {
            properties?: {
              code?: {
                enum?: string[];
              };
            };
          };
        };
      }>;
    };

    expectArrayToIncludeValues(
      decideOutputSchema.oneOf?.[1]?.properties?.failure?.properties?.code?.enum,
      TRACK_CHANGES_DECIDE_RECEIPT_FAILURE_CODES,
      'trackChanges.decide output schema failure code enum',
    );
  });

  it('accepts structured list delta facts on trackChanges.get and list while rejecting unknown fields (TC-LIST-003/004)', () => {
    const schemas = buildInternalContractSchemas();
    const getOutput = schemas.operations['trackChanges.get'].output as ContractTestSchemaShape;
    const listOutput = schemas.operations['trackChanges.list'].output as ContractTestSchemaShape;
    const listItem = listOutput.properties?.items?.items;
    const validMemberDelta = {
      kind: 'list-add',
      from: { hasNumPr: false, numId: null, ilvl: null, styleKind: null },
      to: { hasNumPr: true, numId: '7', ilvl: 0, styleKind: 'number' },
    };
    const validListFactPayload = {
      listDeltas: [validMemberDelta],
      listDeltaSummary: { uniformKind: 'list-add', counts: { 'list-add': 1 } },
      targetIsListItem: true,
      listActionKind: 'merge-items',
    };
    const unknownFieldPayloads = [
      { ...validListFactPayload, unexpectedRowField: true },
      {
        ...validListFactPayload,
        listDeltas: [{ ...validMemberDelta, unexpectedMemberField: true }],
      },
      {
        ...validListFactPayload,
        listDeltas: [
          {
            ...validMemberDelta,
            from: { ...validMemberDelta.from, unexpectedSideField: true },
          },
        ],
      },
      {
        ...validListFactPayload,
        listDeltaSummary: {
          ...validListFactPayload.listDeltaSummary,
          counts: { ...validListFactPayload.listDeltaSummary.counts, unexpectedKind: 1 },
        },
      },
    ];

    for (const surface of [getOutput, listItem]) {
      expect(collectUnknownPropertySchemaErrors(surface, validListFactPayload)).toEqual([]);
      for (const payload of unknownFieldPayloads) {
        expect(collectUnknownPropertySchemaErrors(surface, payload).length).toBeGreaterThan(0);
      }
    }
  });

  it('accepts custom tracked-change attributes on list and get while rejecting unknown fields', () => {
    const schemas = buildInternalContractSchemas();
    const getOutput = schemas.operations['trackChanges.get'].output as ContractTestSchemaShape;
    const listOutput = schemas.operations['trackChanges.list'].output as ContractTestSchemaShape;
    const listItem = listOutput.properties?.items?.items;
    const value = [
      {
        name: 'ext:reason',
        namespaceUri: 'https://example.test/ns/edit',
        localName: 'reason',
        value: 'customer-request',
      },
    ];

    for (const surface of [getOutput, listItem]) {
      expect(collectUnknownPropertySchemaErrors(surface, { customAttributes: value })).toEqual([]);
      expect(
        collectUnknownPropertySchemaErrors(surface, {
          customAttributes: [{ ...value[0], unexpected: true }],
        }),
      ).toHaveLength(1);
    }
  });

  it('ensures every operation has a non-empty expectedResult', () => {
    for (const id of OPERATION_IDS) {
      const expectedResult = OPERATION_DEFINITIONS[id].expectedResult;
      expect(expectedResult, `${id} has empty expectedResult`).toBeTruthy();
      expect(typeof expectedResult).toBe('string');
      expect(expectedResult.length, `${id} expectedResult is too short`).toBeGreaterThan(10);
    }
  });

  it('keeps public mutation step ops explicit and reference-valid', () => {
    expect(PUBLIC_MUTATION_STEP_OP_IDS.length).toBeGreaterThan(0);
    expect(new Set(PUBLIC_MUTATION_STEP_OP_IDS).size).toBe(PUBLIC_MUTATION_STEP_OP_IDS.length);
    expect(PUBLIC_MUTATION_STEP_OP_IDS).not.toContain('domain.command');
    expect(PUBLIC_MUTATION_STEP_OP_IDS).toContain('assert');

    const validOperationIds = new Set<string>(OPERATION_IDS);
    for (const stepOp of STEP_OP_CATALOG) {
      if (!stepOp.referenceOperationId) continue;
      expect(
        validOperationIds.has(stepOp.referenceOperationId),
        `${stepOp.opId} references unknown operation ${stepOp.referenceOperationId}`,
      ).toBe(true);
    }
  });

  it('marks exactly the out-of-band mutation operations as historyUnsafe', () => {
    const historyUnsafeOps = OPERATION_IDS.filter((id) => COMMAND_CATALOG[id].historyUnsafe === true).sort();

    // styles.apply + all sections.set* / sections.clear* mutations
    expect(historyUnsafeOps).toContain('styles.apply');
    expect(historyUnsafeOps).toContain('styles.create');
    for (const id of historyUnsafeOps) {
      expect(
        id.startsWith('sections.') ||
          id.startsWith('headerFooters.') ||
          id === 'styles.apply' ||
          id === 'styles.create' ||
          id === 'templates.apply' ||
          id === 'tables.setDefaultStyle' ||
          id === 'tables.clearDefaultStyle' ||
          id === 'diff.apply',
        `unexpected historyUnsafe: ${id}`,
      ).toBe(true);
    }

    // All section mutations (set*/clear*) should be marked
    const sectionMutations = OPERATION_IDS.filter((id) => id.startsWith('sections.') && COMMAND_CATALOG[id].mutates);
    for (const id of sectionMutations) {
      expect(COMMAND_CATALOG[id].historyUnsafe, `${id} should be historyUnsafe`).toBe(true);
    }

    // Non-mutating and non-out-of-band operations should NOT be historyUnsafe
    for (const id of OPERATION_IDS) {
      if (!COMMAND_CATALOG[id].mutates || historyUnsafeOps.includes(id)) continue;
      expect(COMMAND_CATALOG[id].historyUnsafe, `${id} should not be historyUnsafe`).toBeFalsy();
    }
  });

  it('keeps returnsPromise a strict true-or-absent flag', () => {
    for (const id of OPERATION_IDS) {
      const value = COMMAND_CATALOG[id].returnsPromise;
      expect(value === true || value === undefined, `${id} returnsPromise must be true or undefined`).toBe(true);
    }
  });
});

describe('public mutation result vocabulary', () => {
  it('preserves declared formatting geometry in tracked-change list and get targets', () => {
    const target: Extract<TrackChangeTarget, { kind: 'formatting' }> = {
      kind: 'formatting',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'run-formatting' },
      subtype: 'run',
      segments: [{ blockId: 'formatted-paragraph', range: { start: 0, end: 25 } }],
      story: { kind: 'story', storyType: 'body' },
      coordinateSpace: 'tracked',
      targetKind: 'run',
      semanticSubtype: 'run-formatting',
      carriers: ['w:rPrChange'],
    };
    const schemas = buildInternalContractSchemas();
    const get = schemas.operations['trackChanges.get'].output as ContractTestSchemaShape;
    const list = schemas.operations['trackChanges.list'].output as ContractTestSchemaShape;
    for (const surface of [get, list.properties?.items?.items]) {
      const branch = surface?.properties?.target?.oneOf?.find((candidate) =>
        candidate.properties?.kind?.enum?.includes('formatting'),
      );
      expect(branch).toBeDefined();
      expect(collectUnknownPropertySchemaErrors(branch, target)).toEqual([]);
      expect(branch?.additionalProperties).toBe(false);
      expect(collectUnknownPropertySchemaErrors(branch, { ...target, unexpected: true })).toContain(
        '$.unexpected: unknown property',
      );
    }
  });

  it('accepts runtime preview flags inside section and document mutation receipts', () => {
    const schemas = buildInternalContractSchemas();
    const section = { success: true, section: { kind: 'section', sectionId: 'section-1' }, dryRun: true };
    const document = { success: true, dryRun: true };
    for (const [schema, receipt] of [
      [schemas.operations['sections.setPageSetup'].success, section],
      [schemas.operations['sections.setLinkToPrevious'].success, section],
      [schemas.operations['sections.setOddEvenHeadersFooters'].success, document],
    ] as const) {
      expect(collectUnknownPropertySchemaErrors(schema as ContractTestSchemaShape, receipt)).toEqual([]);
      expect(schema?.additionalProperties).toBe(false);
      expect(
        collectUnknownPropertySchemaErrors(schema as ContractTestSchemaShape, { ...receipt, unexpected: true }),
      ).toContain('$.unexpected: unknown property');
    }
  });

  it('accepts no-change document receipts and tracked section-break references on closed schemas', () => {
    const schemas = buildInternalContractSchemas();
    for (const [operation, receipt] of [
      ['tables.setDefaultStyle', { success: true, changed: false }],
      [
        'create.sectionBreak',
        {
          success: true,
          appliedChangeMode: 'tracked',
          section: { kind: 'section', sectionId: 'section-1' },
          trackedChangeRefs: [{ kind: 'entity', entityType: 'trackedChange', entityId: 'section-change' }],
        },
      ],
    ] as const) {
      for (const candidate of [schemas.operations[operation].output, schemas.operations[operation].success]) {
        const root = candidate as ContractTestSchemaShape;
        const schema = root.oneOf?.find((branch) => branch.properties?.success?.const === true) ?? root;
        expect(schema.additionalProperties).toBe(false);
        expect(collectUnknownPropertySchemaErrors(schema as ContractTestSchemaShape, receipt)).toEqual([]);
        expect(
          collectUnknownPropertySchemaErrors(schema as ContractTestSchemaShape, { ...receipt, unexpected: true }),
        ).toContain('$.unexpected: unknown property');
      }
    }
  });

  it('keeps captured list restart metadata available on closed read and application schemas', () => {
    const schemas = buildInternalContractSchemas();
    for (const [operation, field] of [
      ['lists.getStyle', 'style'],
      ['lists.captureTemplate', 'template'],
    ] as const) {
      const receipt = { success: true, [field]: { version: 1, levels: [{ level: 1, lvlRestart: 0 }] } };
      for (const candidate of [schemas.operations[operation].output, schemas.operations[operation].success]) {
        const root = candidate as ContractTestSchemaShape;
        const schema = root.oneOf?.find((branch) => branch.properties?.success?.const === true) ?? root;
        expect(schema.additionalProperties).toBe(false);
        expect(collectUnknownPropertySchemaErrors(schema as ContractTestSchemaShape, receipt)).toEqual([]);
        const bad = { success: true, [field]: { version: 1, levels: [{ level: 1, lvlRestart: 0, unexpected: true }] } };
        expect(collectUnknownPropertySchemaErrors(schema as ContractTestSchemaShape, bad)).toContain(
          `$.${field}.levels[0].unexpected: unknown property`,
        );
      }
    }
    for (const [operation, field] of [
      ['lists.applyStyle', 'style'],
      ['lists.applyTemplate', 'template'],
    ] as const) {
      const input = {
        target: { kind: 'block', nodeType: 'listItem', nodeId: 'list-1' },
        [field]: { version: 1, levels: [{ level: 1, lvlRestart: 0 }] },
      };
      expect(
        collectUnknownPropertySchemaErrors(schemas.operations[operation].input as ContractTestSchemaShape, input),
      ).toEqual([]);
    }
  });

  it('rejects unknown fields on extracted tracked changes and their span marks', () => {
    const schema = buildInternalContractSchemas().operations.extract.output as ContractTestSchemaShape;
    const change = schema.properties!.trackedChanges!.items!;
    const mark = schema.properties!.blocks!.items!.properties!.textSpans!.items!.properties!.trackedChanges!.items!;
    for (const surface of [change, mark]) {
      expect(
        collectUnknownPropertySchemaErrors(surface, { entityId: 'change-1', type: 'insertion', unexpected: true }),
      ).toContain('$.unexpected: unknown property');
    }
  });

  it('accepts the typed tracked block deletion receipt on closed output and success schemas', () => {
    const receipt: BlocksDeleteResult = {
      success: true,
      appliedChangeMode: 'tracked',
      deleted: { kind: 'block', nodeType: 'table', nodeId: 'tracked-table' },
      trackedChangeRefs: [{ kind: 'entity', entityType: 'trackedChange', entityId: 'table-deletion' }],
    };
    const result = executeBlocksDelete({ delete: () => receipt }, { target: receipt.deleted });
    const schemas = buildInternalContractSchemas().operations['blocks.delete'];
    for (const schema of [schemas.output, schemas.success]) {
      expect(collectUnknownPropertySchemaErrors(schema as ContractTestSchemaShape, result)).toEqual([]);
      expect(schema?.additionalProperties).toBe(false);
      expect(
        collectUnknownPropertySchemaErrors(schema as ContractTestSchemaShape, { ...result, unexpected: true }),
      ).toContain('$.unexpected: unknown property');
    }
  });

  it('accepts paired tracked move references on closed output and success schemas', () => {
    const receipt: BlocksMoveResult = {
      success: true,
      appliedChangeMode: 'tracked',
      moved: { kind: 'block', nodeType: 'paragraph', nodeId: 'moved-paragraph' },
      trackedChangeRefs: [{ kind: 'entity', entityType: 'trackedChange', entityId: 'paired-move' }],
    };
    const result = executeBlocksMove(
      { move: () => receipt },
      {
        source: receipt.moved,
        destination: { kind: 'block', nodeType: 'paragraph', nodeId: 'anchor-paragraph' },
        placement: 'after',
      },
    );
    const schemas = buildInternalContractSchemas().operations['blocks.move'];
    for (const schema of [schemas.output, schemas.success]) {
      expect(collectUnknownPropertySchemaErrors(schema as ContractTestSchemaShape, result)).toEqual([]);
      expect(schema?.additionalProperties).toBe(false);
      expect(
        collectUnknownPropertySchemaErrors(schema as ContractTestSchemaShape, { ...result, unexpected: true }),
      ).toContain('$.unexpected: unknown property');
    }
  });

  it('accepts the successful clearContent NO_OP receipt without opening receipt objects', () => {
    const success = (buildInternalContractSchemas().$defs as Record<string, ContractTestSchemaShape>).ReceiptSuccess;
    expect(collectUnknownPropertySchemaErrors(success, { success: true, status: 'NO_OP' })).toEqual([]);
    expect(collectUnknownPropertySchemaErrors(success, { success: true, unexpected: true })).toEqual([
      '$.unexpected: unknown property',
    ]);
  });

  it('preserves complete receipt metadata across text, image, list, hyperlink, plan and structural results', () => {
    const schemas = buildInternalContractSchemas();
    const defs = schemas.$defs as Record<string, ContractTestSchemaShape>;
    const metadata = {
      txId: 'transaction-1',
      affectedStories: [{ kind: 'story', storyType: 'body' }],
      invalidatedRefs: [],
      remappedRefs: [],
      textRangeShifts: [],
      trackedTextRangeShifts: [],
      trackedChangeRefs: [{ kind: 'entity', entityType: 'trackedChange', entityId: 'change-1' }],
      trackedChangeCount: 1,
      changed: true,
    };
    const cases = [
      'delete',
      'create.image',
      'images.setLockAspectRatio',
      'lists.create',
      'lists.join',
      'lists.separate',
      'lists.merge',
      'lists.split',
      'lists.detach',
      'lists.convertToText',
      'lists.delete',
      'hyperlinks.insert',
      'contentControls.insertAfter',
      'blocks.split',
      'blocks.merge',
      'mutations.apply',
    ] as const;
    for (const id of cases) {
      const operation = schemas.operations[id];
      const declared = operation.success as ContractTestSchemaShape;
      const success = declared.$ref ? defs[declared.$ref.split('/').at(-1)!] : declared;
      expect(success.additionalProperties, id).toBe(false);
      expect(collectUnknownPropertySchemaErrors(success, metadata), id).toEqual([]);
      expect(collectUnknownPropertySchemaErrors(success, { ...metadata, unknownMutationField: true }), id).toContain(
        '$.unknownMutationField: unknown property',
      );
      expect(operation.failure, `${id} retains its failure schema`).toBeDefined();
    }
  });

  it('types clipboard insertion plans and diagnostics while rejecting nested unknown fields', () => {
    const schema = buildInternalContractSchemas().operations['clipboard.insert'].success as ContractTestSchemaShape;
    const sample = {
      success: true,
      txId: 'clipboard-1',
      affectedStories: [{ kind: 'story', storyType: 'body' }],
      plan: { sourceKind: 'plain-text', blockCount: 1, assetCount: 0, imageRefCount: 0, plainFallback: false },
      diagnostics: [
        {
          code: 'paste-empty',
          severity: 'warning',
          message: 'Empty source',
          reason: 'paste-empty',
          sourceKind: 'empty',
        },
      ],
    };
    expect(collectUnknownPropertySchemaErrors(schema, sample)).toEqual([]);
    expect(
      collectUnknownPropertySchemaErrors(schema, { ...sample, plan: { ...sample.plan, unknownPlanField: true } }),
    ).toContain('$.plan.unknownPlanField: unknown property');
    expect(
      collectUnknownPropertySchemaErrors(schema, {
        ...sample,
        diagnostics: [{ ...sample.diagnostics[0], unknownDiagnosticField: true }],
      }),
    ).toContain('$.diagnostics[0].unknownDiagnosticField: unknown property');
  });

  it('keeps nonempty discovery items closed', () => {
    const schemas = buildInternalContractSchemas();
    for (const id of ['watermarks.list', 'hyperlinks.list'] as const) {
      const item = (schemas.operations[id].output as ContractTestSchemaShape).properties?.items?.items;
      expect(collectUnknownPropertySchemaErrors(item, { unknownDiscoveryField: true })).toContain(
        '$.unknownDiscoveryField: unknown property',
      );
    }
  });
});

describe('metadata.get and metadata.resolve with the physical control', () => {
  const physicalControlInput = {
    id: 'customer-entry',
    contentControlId: '4001',
    story: { kind: 'story', storyType: 'body' },
  };

  it.each(['metadata.resolve', 'metadata.get'] as const)(
    'the published %s input schema accepts id, contentControlId and story',
    (operationId) => {
      const input = buildInternalContractSchemas().operations[operationId].input as ContractTestSchemaShape;
      expect(collectUnknownPropertySchemaErrors(input, physicalControlInput)).toEqual([]);
    },
  );
});
