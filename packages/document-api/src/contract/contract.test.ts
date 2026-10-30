import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { COMMAND_CATALOG, OPERATION_DESCRIPTION_MAP, OPERATION_EXPECTED_RESULT_MAP } from './command-catalog.js';
import { OPERATION_DEFINITIONS, type ReferenceGroupKey } from './operation-definitions.js';
import { DOCUMENT_API_MEMBER_PATHS, OPERATION_MEMBER_PATH_MAP, memberPathForOperation } from './operation-map.js';
import { OPERATION_REFERENCE_DOC_PATH_MAP, REFERENCE_OPERATION_GROUPS } from './reference-doc-map.js';
import { buildInternalContractSchemas } from './schemas.js';
import { PUBLIC_MUTATION_STEP_OP_IDS, STEP_OP_CATALOG } from './step-op-catalog.js';
import { OPERATION_IDS, PRE_APPLY_THROW_CODES, isValidOperationIdFormat } from './types.js';
import { Z_ORDER_RELATIVE_HEIGHT_MAX, Z_ORDER_RELATIVE_HEIGHT_MIN } from '../images/z-order.js';
import type { TemplatesApplyFailureCode } from '../templates/index.js';
import type { ReceiptFailureCode } from '../types/index.js';
import { executeBlocksDelete, executeBlocksMove } from '../blocks/blocks.js';
import type { BlocksDeleteResult, BlocksMoveResult } from '../types/blocks.types.js';
import type { TrackChangeTarget } from '../types/track-changes.types.js';
import { CAPABILITY_REASON_CODES } from '../capabilities/capabilities.js';
import { LIST_CUSTOM_NUMBERING_FORMATS } from '../lists/lists.types.js';
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

function expectBroadSDFragmentSchema(schema: ContractTestSchemaShape | undefined): void {
  expect(schema?.oneOf).toHaveLength(2);
  expect(schema?.oneOf?.[0]).toEqual({ type: 'object' });
  expect(schema?.oneOf?.[1]).toEqual({ type: 'array', items: { type: 'object' } });
}

describe('document-api contract catalog', () => {
  it('derives legacy tracked booleans from the canonical support level', () => {
    for (const operationId of OPERATION_IDS) {
      const metadata = OPERATION_DEFINITIONS[operationId].metadata;
      expect(['always', 'conditional', 'never']).toContain(metadata.trackedSupport);
      expect(metadata.supportsTrackedMode).toBe(metadata.trackedSupport === 'always');
      expect(metadata.supportsConditionalTrackedMode === true).toBe(metadata.trackedSupport === 'conditional');
    }
  });

  it('advertises tracked create.contentControl support for its bounded supported shapes', () => {
    expect(OPERATION_DEFINITIONS['create.contentControl'].metadata.supportsTrackedMode).toBe(true);
  });

  it('publishes the complete outbound projection DTO vocabulary without changing operation returns', () => {
    const schemas = buildInternalContractSchemas();
    const defs = schemas.$defs as Record<string, ContractTestSchemaShape>;
    expect(defs.TextTarget?.properties?.coordinateSpace).toEqual({ $ref: '#/$defs/TextCoordinateSpace' });
    expect(defs.SDProjectionFormat?.enum).toEqual(['html', 'markdown']);
    expect(defs.SDProjectionReviewMode?.enum).toEqual(['final', 'original', 'redline']);
    expect(defs.SDProjectionStatus?.enum).toEqual(['success', 'warning', 'failed']);
    expect(defs.SDProjectionBlockMapEntry?.oneOf).toHaveLength(2);
    expect(defs.SDProjectionSourceMapSyntheticEntry?.oneOf).toHaveLength(2);
    expect(defs.SDContentProjectionResult?.required).toContain('evaluatedRevision');
    expect(schemas.operations.getHtml.output).toEqual({ type: 'string' });
    expect(schemas.operations.getMarkdown.output).toEqual({ type: 'string' });
  });

  it('keeps operation ids explicit and format-valid', () => {
    expect([...new Set(OPERATION_IDS)]).toHaveLength(OPERATION_IDS.length);
    for (const operationId of OPERATION_IDS) {
      expect(isValidOperationIdFormat(operationId)).toBe(true);
    }
  });

  it('exposes legal numbering on lists.setLevelNumbering', () => {
    const schemas = buildInternalContractSchemas();
    const input = schemas.operations['lists.setLevelNumbering'].input as ContractTestSchemaShape;
    expect(input.properties?.isLgl).toEqual({ type: 'boolean' });
    expect(input.required).not.toContain('isLgl');
  });

  it('exposes optional custom numbering on the existing per-level operation and nested styles', () => {
    const schemas = buildInternalContractSchemas();
    const input = schemas.operations['lists.setLevelNumbering'].input as ContractTestSchemaShape;
    const customFormat = {
      type: 'string',
      minLength: 1,
      examples: [...LIST_CUSTOM_NUMBERING_FORMATS],
      description: 'New formats use 2–4 digit zero-padded samples; other values must already exist in the document.',
    };
    expect(input.properties?.customFormat).toEqual(customFormat);
    expect(input.required).not.toContain('customFormat');
    for (const operation of ['lists.create', 'lists.applyTemplate', 'lists.applyStyle'] as const) {
      const schema = schemas.operations[operation];
      expect(JSON.stringify(schema.input)).toContain(`"customFormat":${JSON.stringify(customFormat)}`);
    }
    for (const operation of ['lists.captureTemplate', 'lists.getStyle'] as const) {
      expect(JSON.stringify(schemas.operations[operation].output)).toContain('"customFormat":{"type":"string"}');
    }
  });

  it('publishes Hebrew page-numbering formats for section reads and writes', () => {
    const schemas = buildInternalContractSchemas();
    const formats = [
      'decimal',
      'lowerLetter',
      'upperLetter',
      'lowerRoman',
      'upperRoman',
      'numberInDash',
      'hebrew1',
      'hebrew2',
    ];
    const setInput = schemas.operations['sections.setPageNumbering'].input as ContractTestSchemaShape;
    const listOutput = schemas.operations['sections.list'].output as ContractTestSchemaShape;
    const listedFormat = listOutput.properties?.items?.items?.properties?.pageNumbering?.properties?.format;

    expect(setInput.properties?.format?.enum).toEqual(formats);
    expect(listedFormat?.enum).toEqual(formats);
  });

  it('publishes review-aware blocks.list input and effective-mode output', () => {
    const schemas = buildInternalContractSchemas();
    const operation = schemas.operations['blocks.list'];
    const input = operation.input as ContractTestSchemaShape;
    const output = operation.output as ContractTestSchemaShape;

    expect(input.properties?.reviewMode).toEqual({ $ref: '#/$defs/SDProjectionReviewMode' });
    expect(input.required ?? []).not.toContain('reviewMode');
    expect(output.properties?.reviewMode).toEqual({ $ref: '#/$defs/SDProjectionReviewMode' });
    expect(output.required).toContain('reviewMode');
  });

  it('publishes complete-text tab counts for blocks.list consumers', () => {
    const output = buildInternalContractSchemas().operations['blocks.list'].output as ContractTestSchemaShape;
    expect(output.properties?.blocks?.items?.properties?.tabCount).toMatchObject({ type: 'integer', minimum: 0 });
  });

  it('publishes optional story hints and deterministic node ID lookup failures', () => {
    const input = buildInternalContractSchemas().operations.getNodeById.input as ContractTestSchemaShape;
    expect(input.properties?.story).toBeDefined();
    expect(input.required).toEqual(['nodeId']);
    expect(OPERATION_DEFINITIONS.getNodeById.inputAliases).toEqual({ id: 'nodeId' });
    expect(OPERATION_DEFINITIONS.getNode.metadata.throws.preApply).toContain('AMBIGUOUS_TARGET');
    expect(OPERATION_DEFINITIONS.getNodeById.metadata.throws.preApply).toEqual(
      expect.arrayContaining(['TARGET_NOT_FOUND', 'AMBIGUOUS_TARGET', 'CAPABILITY_UNAVAILABLE']),
    );
  });

  it('accepts tracked definition-replay blockers in diff payloads across compare and apply', () => {
    const operations = buildInternalContractSchemas().operations;
    const compareOutput = operations['diff.compare'].output as ContractTestSchemaShape;
    const applyInput = operations['diff.apply'].input as ContractTestSchemaShape;
    const compareCodes =
      compareOutput.properties?.applyEligibility?.properties?.tracked?.properties?.blockers?.items?.properties?.code
        ?.enum;
    const applyCodes =
      applyInput.properties?.diff?.properties?.applyEligibility?.properties?.tracked?.properties?.blockers?.items
        ?.properties?.code?.enum;

    expect(compareCodes).toContain('definition-replay-tracked-unsupported');
    expect(compareCodes).toContain('package-graph-tracked-unsupported');
    expect(applyCodes).toEqual(compareCodes);
    expect(applyInput.properties?.diff?.properties?.partChanges).toEqual(compareOutput.properties?.partChanges);
  });

  it('keeps catalog key coverage in lockstep with operation ids', () => {
    const catalogKeys = Object.keys(COMMAND_CATALOG).sort();
    const operationIds = [...OPERATION_IDS].sort();
    expect(catalogKeys).toEqual(operationIds);
  });

  it('derives member paths from operation ids with no duplicates', () => {
    expect(new Set(DOCUMENT_API_MEMBER_PATHS).size).toBe(DOCUMENT_API_MEMBER_PATHS.length);
    for (const operationId of OPERATION_IDS) {
      expect(typeof memberPathForOperation(operationId)).toBe('string');
    }
  });

  it('keeps reference-doc mappings explicit and coverage-complete', () => {
    const operationIds = [...OPERATION_IDS].sort();
    const docPathKeys = Object.keys(OPERATION_REFERENCE_DOC_PATH_MAP).sort();
    expect(docPathKeys).toEqual(operationIds);

    const grouped = REFERENCE_OPERATION_GROUPS.flatMap((group) => group.operations);
    expect(grouped).toHaveLength(operationIds.length);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(operationIds);
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

  it('publishes list mutation receipt metadata on continuePrevious success', () => {
    const schemas = buildInternalContractSchemas();
    const outputSchema = schemas.operations['lists.continuePrevious'].output as ContractTestSchemaShape;
    const successSchema = outputSchema.oneOf?.find((schema) => schema.properties?.success?.const === true);

    expect(successSchema).toBeDefined();
    expect(successSchema!.additionalProperties).toBe(false);
    expect(successSchema!.required ?? []).not.toContain('temporary');
    expect(Object.keys(successSchema!.properties!).sort()).toEqual([
      'affectedStories',
      'appliedChangeMode',
      'changeTag',
      'changed',
      'effects',
      'id',
      'inserted',
      'invalidatedRefs',
      'item',
      'remappedRefs',
      'removed',
      'status',
      'success',
      'temporary',
      'textRangeShifts',
      'trackedChangeCount',
      'trackedChangeRefs',
      'trackedTextRangeShifts',
      'txId',
      'updated',
      'warnings',
    ]);
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

  it('declares insert input as plain text, rich string, or structural content', () => {
    const schemas = buildInternalContractSchemas();
    const insertInputSchema = schemas.operations.insert.input as {
      oneOf?: Array<{
        oneOf?: Array<{
          type?: string;
          properties?: Record<string, unknown>;
          required?: string[];
          additionalProperties?: boolean;
        }>;
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
      }>;
    };

    expect(Array.isArray(insertInputSchema.oneOf)).toBe(true);
    expect(insertInputSchema.oneOf).toHaveLength(5);

    const [, , textVariant, richVariant, structuralVariant] = insertInputSchema.oneOf!;

    expect(Array.isArray(textVariant.oneOf)).toBe(true);
    expect(textVariant.oneOf).toHaveLength(3);

    const [textTargetVariant, textRefVariant, textUntargetedVariant] = textVariant.oneOf!;

    expect(textTargetVariant.type).toBe('object');
    expect(Object.keys(textTargetVariant.properties!).sort()).toEqual(['in', 'target', 'type', 'value']);
    expect(textTargetVariant.required).toEqual(['target', 'value']);
    expect(textTargetVariant.additionalProperties).toBe(false);
    expect((textTargetVariant.properties!.target as { $ref?: string }).$ref).toBe('#/$defs/SelectionTarget');

    expect(textRefVariant.type).toBe('object');
    expect(Object.keys(textRefVariant.properties!).sort()).toEqual(['in', 'ref', 'type', 'value']);
    expect(textRefVariant.required).toEqual(['ref', 'value']);
    expect(textRefVariant.additionalProperties).toBe(false);
    expect((textRefVariant.properties!.ref as { type?: string }).type).toBe('string');

    expect(textUntargetedVariant.type).toBe('object');
    expect(Object.keys(textUntargetedVariant.properties!).sort()).toEqual(['in', 'type', 'value']);
    expect(textUntargetedVariant.required).toEqual(['value']);
    expect(textUntargetedVariant.additionalProperties).toBe(false);

    expect(Array.isArray(richVariant.oneOf)).toBe(true);
    expect(richVariant.oneOf).toHaveLength(3);
    const [richTargetVariant, richRefVariant, richUntargetedVariant] = richVariant.oneOf!;
    expect(Object.keys(richTargetVariant.properties!).sort()).toEqual(['in', 'placement', 'target', 'type', 'value']);
    expect(richTargetVariant.required).toEqual(['target', 'value', 'type']);
    expect(richTargetVariant.additionalProperties).toBe(false);
    expect((richTargetVariant.properties!.target as { oneOf?: unknown[] }).oneOf).toHaveLength(2);
    expect(richRefVariant.required).toEqual(['ref', 'value', 'type']);
    expect(richRefVariant.additionalProperties).toBe(false);
    expect(richUntargetedVariant.required).toEqual(['value', 'type']);
    expect(richUntargetedVariant.additionalProperties).toBe(false);
    expect((richTargetVariant.properties!.type as { enum?: string[] }).enum).toEqual(['markdown', 'html']);

    expect(structuralVariant.type).toBe('object');
    expect(Object.keys(structuralVariant.properties!).sort()).toEqual([
      'content',
      'in',
      'nestingPolicy',
      'placement',
      'target',
    ]);
    expect(structuralVariant.required).toEqual(['content']);
    expect(structuralVariant.additionalProperties).toBe(false);
    expect((structuralVariant.properties!.target as { $ref?: string }).$ref).toBe('#/$defs/BlockNodeAddress');
    expect((structuralVariant.properties!.placement as { enum?: string[] }).enum).toEqual([
      'before',
      'after',
      'insideStart',
      'insideEnd',
    ]);
    expect(
      (
        structuralVariant.properties!.nestingPolicy as {
          properties?: { tables?: { enum?: string[] } };
        }
      ).properties?.tables?.enum,
    ).toEqual(['forbid', 'allow']);
  });

  it('publishes strict rich replace variants without overlapping legacy shapes', () => {
    const schemas = buildInternalContractSchemas();
    const replaceInput = schemas.operations.replace.input as {
      oneOf?: Array<{
        oneOf?: Array<{
          properties?: Record<string, unknown>;
          required?: string[];
          additionalProperties?: boolean;
        }>;
      }>;
    };

    expect(replaceInput.oneOf).toHaveLength(8);
    const rich = replaceInput.oneOf?.[7];
    expect(rich?.oneOf).toHaveLength(3);
    const [targetVariant, refVariant, bodyVariant] = rich!.oneOf!;
    expect(Object.keys(targetVariant.properties!).sort()).toEqual(['in', 'nestingPolicy', 'target', 'type', 'value']);
    expect(targetVariant.required).toEqual(['target', 'value', 'type']);
    expect(targetVariant.additionalProperties).toBe(false);
    expect(refVariant.required).toEqual(['ref', 'value', 'type']);
    expect(refVariant.additionalProperties).toBe(false);
    expect(Object.keys(bodyVariant.properties!).sort()).toEqual(['target', 'type', 'value']);
    expect(bodyVariant.required).toEqual(['target', 'value', 'type']);
    expect(bodyVariant.additionalProperties).toBe(false);
  });

  it('publishes a strict HTML conversion schema and a unique reference path', () => {
    const schemas = buildInternalContractSchemas();
    const htmlOperation = schemas.operations.htmlToFragment;
    const output = htmlOperation.output as {
      properties?: {
        diagnostics?: {
          items?: { required?: string[]; additionalProperties?: boolean; properties?: Record<string, unknown> };
        };
      };
    };
    const diagnostic = output.properties?.diagnostics?.items;

    expect((htmlOperation.input as { required?: string[]; additionalProperties?: boolean }).required).toEqual(['html']);
    expect((htmlOperation.input as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    expect(diagnostic?.required).toEqual([
      'code',
      'severity',
      'message',
      'construct',
      'disposition',
      'lossy',
      'source',
    ]);
    expect(diagnostic?.additionalProperties).toBe(false);
    expect(OPERATION_REFERENCE_DOC_PATH_MAP.htmlToFragment).toBe('html-to-fragment.mdx');
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

  it('publishes concrete recursive fragments for both conversion operations', () => {
    const schemas = buildInternalContractSchemas();
    const defs = schemas.$defs as Record<string, ContractTestSchemaShape>;

    for (const operationId of ['htmlToFragment', 'markdownToFragment'] as const) {
      const output = schemas.operations[operationId].output as ContractTestSchemaShape;
      const fragment = output.properties?.fragment;
      expect(fragment?.oneOf).toHaveLength(2);
      const [singleNode, nodeArray] = fragment!.oneOf!;
      expect(singleNode.oneOf?.map((variant) => variant.properties?.kind?.const)).toEqual([
        'paragraph',
        'heading',
        'list',
        'table',
        'horizontalRule',
      ]);
      expect(nodeArray).toMatchObject({ type: 'array', minItems: 1 });
      expect(nodeArray.items).toEqual(singleNode);
      expect(JSON.stringify(fragment)).toContain('"header"');
      expect(JSON.stringify(fragment)).toContain('"horizontalRule"');
    }

    expect(defs.SDInboundContentNode?.oneOf?.map((variant) => variant.$ref)).toEqual([
      '#/$defs/SDInboundParagraph',
      '#/$defs/SDInboundHeading',
      '#/$defs/SDInboundList',
      '#/$defs/SDInboundTable',
      '#/$defs/SDInboundHorizontalRule',
    ]);
    expect(defs.SDInboundInlineNode?.oneOf?.map((variant) => variant.$ref)).toEqual([
      '#/$defs/SDInboundRun',
      '#/$defs/SDInboundHyperlink',
      '#/$defs/SDInboundLineBreak',
    ]);

    const paragraphPayload = defs.SDInboundParagraph?.properties?.paragraph;
    expect(Object.keys(paragraphPayload?.properties ?? {}).sort()).toEqual(['inlines', 'props', 'styleRef']);
    expect(paragraphPayload?.properties?.inlines?.items?.$ref).toBe('#/$defs/SDInboundInlineNode');

    const listItem = defs.SDInboundListItem;
    expect(listItem?.properties?.content?.items?.$ref).toBe('#/$defs/SDInboundContentNode');
    expect(listItem?.properties?.content?.minItems).toBe(1);
    expect(defs.SDInboundListLevel?.properties?.format?.enum).toEqual([
      'decimal',
      'lowerLetter',
      'upperLetter',
      'lowerRoman',
      'upperRoman',
    ]);
    expect(defs.SDInboundListLevel?.properties?.text?.pattern).toBe('^%[1-9][.)]$');

    const tableCell = defs.SDInboundTableCell;
    expect(Object.keys(tableCell?.properties ?? {}).sort()).toEqual([
      'colSpan',
      'content',
      'header',
      'id',
      'props',
      'rowSpan',
    ]);
    expect(tableCell?.properties?.header?.type).toBe('boolean');
    expect(tableCell?.properties?.content?.items?.$ref).toBe('#/$defs/SDInboundContentNode');

    const horizontalRulePayload = defs.SDInboundHorizontalRule?.properties?.horizontalRule;
    expect(horizontalRulePayload).toMatchObject({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });

    for (const [name, schema] of Object.entries(defs)) {
      if (!name.startsWith('SDInbound') || schema.type !== 'object') continue;
      expect(schema.additionalProperties, `${name} must stay closed`).toBe(false);
    }
  });

  it('keeps SDMutation success metadata complete and failure branches identity-free', () => {
    const schemas = buildInternalContractSchemas();
    const expectedSuccessKeys = [
      'affectedStories',
      'appliedChangeMode',
      'changeTag',
      'changed',
      'conversion',
      'effects',
      'evaluatedRevision',
      'id',
      'inserted',
      'invalidatedRefs',
      'outcome',
      'remappedRefs',
      'removed',
      'resolution',
      'status',
      'success',
      'temporary',
      'textRangeShifts',
      'trackedChangeCount',
      'trackedChangeRefs',
      'trackedTextRangeShifts',
      'txId',
      'updated',
      'warnings',
    ];
    const expectedFailureKeys = ['conversion', 'evaluatedRevision', 'failure', 'outcome', 'resolution', 'success'];

    for (const operationId of ['insert', 'replace'] as const) {
      const operation = schemas.operations[operationId];
      const success = operation.success as ContractTestSchemaShape;
      const failure = operation.failure as ContractTestSchemaShape;
      expect(Object.keys(success.properties ?? {}).sort()).toEqual(expectedSuccessKeys);
      expect(Object.keys(failure.properties ?? {}).sort()).toEqual(expectedFailureKeys);
      expect(success.additionalProperties).toBe(false);
      expect(success.required ?? []).not.toContain('temporary');
      expect(failure.additionalProperties).toBe(false);
      expect(failure.properties).not.toHaveProperty('id');
      expect(failure.properties).not.toHaveProperty('inserted');
      expect(failure.properties).not.toHaveProperty('effects');
      expect(failure.properties).not.toHaveProperty('txId');
    }

    const textEffect = schemas.$defs?.TextMutationEffect as ContractTestSchemaShape;
    const blockEffect = schemas.$defs?.BlockMutationEffect as ContractTestSchemaShape;
    expect(textEffect.properties).toHaveProperty('sourcePath');
    expect(blockEffect.properties).toHaveProperty('sourcePath');
    const effects = schemas.$defs?.ReceiptEffects as ContractTestSchemaShape;
    expect(effects.properties?.resultText).toEqual({ $ref: '#/$defs/TextTarget' });
  });

  it.each(['format.paragraph.setAlignment', 'sections.setPageMargins'] as const)(
    'publishes optional committed mode on %s success without changing failures',
    (operationId) => {
      const schemas = buildInternalContractSchemas();
      const output = schemas.operations[operationId].output as ContractTestSchemaShape;
      const success = output.oneOf!.find((schema) => schema.properties?.success?.const === true)!;
      const failure = output.oneOf!.find((schema) => schema.properties?.success?.const === false)!;
      expect(success.properties?.appliedChangeMode).toEqual({ enum: ['direct', 'tracked'] });
      expect(success.required).not.toContain('appliedChangeMode');
      expect(failure.properties).not.toHaveProperty('appliedChangeMode');
    },
  );

  it('publishes structural replacement and optional targeting restrictions in the schema', () => {
    const schemas = buildInternalContractSchemas();
    const input = schemas.operations['mutations.apply'].input as ContractTestSchemaShape;
    const structural = input.properties!.steps.items!.oneOf!.find(
      (step) => step.properties!.op.const === 'structural.replace',
    )!;
    expect(structural.required).toEqual(['id', 'op', 'where', 'args']);
    expect(structural.properties!.where.oneOf!.some((where) => where.properties!.by.const === 'target')).toBe(true);
    expect(structural.properties!.args.required).toEqual(['content']);
    const capabilities = schemas.operations['capabilities.get'].output as ContractTestSchemaShape;
    expect(capabilities.properties!.planEngine.properties!.supportedTargets.items!.type).toBe('string');
    expect(capabilities.properties!.planEngine.required).not.toContain('supportedTargets');
    expect(capabilities.properties!.planEngine.properties!.unsupported.items!.required).toEqual(['cell', 'reason']);
  });

  it.each(['mutations.apply', 'mutations.preview'] as const)(
    'publishes one plan-input display author for %s',
    (operationId) => {
      const input = buildInternalContractSchemas().operations[operationId].input as ContractTestSchemaShape;
      expect(input.properties?.author).toMatchObject({
        type: 'object',
        properties: { name: { type: 'string', minLength: 1 } },
        required: ['name'],
        additionalProperties: false,
      });
      expect(input.required).not.toContain('author');
    },
  );

  it('publishes optional replacementGranularity on text.rewrite step args', () => {
    const schemas = buildInternalContractSchemas();
    const input = schemas.operations['mutations.apply'].input as ContractTestSchemaShape;
    const rewrite = input.properties!.steps.items!.oneOf!.find((step) => step.properties!.op.const === 'text.rewrite')!;
    expect(rewrite.properties!.args.properties!.replacementGranularity).toMatchObject({
      enum: ['word', 'phrase', 'range'],
      type: 'string',
    });
    expect(rewrite.properties!.args.required).toEqual(['replacement']);
    expect(rewrite.properties!.args.additionalProperties).toBe(false);
  });

  it('publishes tracked and invalidated refs from mutation plans', () => {
    const operation = buildInternalContractSchemas().operations['mutations.apply'];
    for (const schema of [operation.output, operation.success] as ContractTestSchemaShape[]) {
      expect(schema.properties?.appliedChangeMode).toEqual({ enum: ['direct', 'tracked'] });
      expect(schema.properties?.steps.items.properties?.appliedChangeMode).toEqual({ enum: ['direct', 'tracked'] });
      expect(schema.properties?.trackedChanges).toEqual({
        type: 'array',
        items: { $ref: '#/$defs/TrackedChangeAddress' },
      });
      expect(schema.properties?.invalidatedRefs).toEqual({
        type: 'array',
        items: { $ref: '#/$defs/AffectedRef' },
      });
    }
  });

  it('allows story-scoped text targets for bookmark inserts', () => {
    const schemas = buildInternalContractSchemas();
    const bookmarkInsertInput = schemas.operations['bookmarks.insert'].input as {
      properties?: {
        at?: { $ref?: string };
      };
    };
    const textTarget = schemas.$defs?.TextTarget as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };

    expect(bookmarkInsertInput.properties?.at?.$ref).toBe('#/$defs/TextTarget');
    expect(textTarget.properties).toHaveProperty('story');
    expect((textTarget.properties?.story as { $ref?: string }).$ref).toBe('#/$defs/StoryLocator');
    expect(textTarget.required).toEqual(['kind', 'segments']);
    expect(textTarget.additionalProperties).toBe(false);
  });

  it('publishes story-scoped range resolution input in the contract schema', () => {
    const schemas = buildInternalContractSchemas();
    const resolveRangeInput = schemas.operations['ranges.resolve'].input as {
      properties?: Record<string, { $ref?: string } | unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };

    expect(resolveRangeInput.properties).toHaveProperty('in');
    expect((resolveRangeInput.properties?.in as { $ref?: string }).$ref).toBe('#/$defs/StoryLocator');
    expect(resolveRangeInput.required).toEqual(['start', 'end']);
    expect(resolveRangeInput.additionalProperties).toBe(false);
  });

  it('publishes the public story locator on citation addresses', () => {
    const schemas = buildInternalContractSchemas();
    const citationInsertOutput = schemas.operations['citations.insert'].output as {
      oneOf?: Array<{
        properties?: {
          citation?: {
            properties?: Record<string, { $ref?: string } | unknown>;
          };
        };
      }>;
    };
    const success = citationInsertOutput.oneOf?.find((variant) => variant.properties?.citation);
    const story = success?.properties?.citation?.properties?.story as { $ref?: string } | undefined;

    expect(story?.$ref).toBe('#/$defs/StoryLocator');
  });

  it('describes ranges.resolve refs as nullable until mutation-ready', () => {
    const description = OPERATION_DESCRIPTION_MAP['ranges.resolve'];
    const expectedResult = OPERATION_EXPECTED_RESULT_MAP['ranges.resolve'];

    expect(description).toContain('handle.ref is nullable');
    expect(description).toContain('mutation-ready');
    expect(description).toContain('handle.ref !== null');
    expect(description).toContain('coversFullTarget');
    expect(expectedResult).toContain('handle.ref may be null');
    expect(expectedResult).toContain('coversFullTarget');
  });

  it('documents reachable ranges.resolve story and ref-resolution validation failures', () => {
    expectArrayToIncludeValues(
      OPERATION_DEFINITIONS['ranges.resolve'].metadata.throws.preApply,
      ['STORY_MISMATCH', 'AMBIGUOUS_MATCH', 'ADDRESS_STALE'],
      'ranges.resolve throws.preApply',
    );
  });

  it('publishes selectionTarget and structured content-control preset inputs in the contract schema', () => {
    const schemas = buildInternalContractSchemas();
    const selectionCurrentOutput = schemas.operations['selection.current'].output as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const createContentControlInput = schemas.operations['create.contentControl'].input as {
      properties?: Record<string, unknown>;
      required?: string[];
      allOf?: Array<Record<string, unknown>>;
    };
    const contentControlInfo = schemas.operations['contentControls.get'].output as {
      properties?: Record<string, unknown>;
    };

    expect(selectionCurrentOutput.properties).toHaveProperty('selectionTarget');
    expect(
      (selectionCurrentOutput.properties?.selectionTarget as { oneOf?: Array<{ $ref?: string } | { type?: string }> })
        .oneOf,
    ).toEqual([{ $ref: '#/$defs/SelectionTarget' }, { type: 'null' }]);
    expect(createContentControlInput.required).toEqual(['kind']);
    expect((createContentControlInput.properties?.html as { type?: string }).type).toBe('string');
    expect(createContentControlInput.properties).toHaveProperty('json');
    expect(createContentControlInput.properties).toHaveProperty('inline');
    expect(createContentControlInput.allOf).toEqual([
      { not: { required: ['at', 'target'] } },
      {
        not: {
          anyOf: [{ required: ['content', 'html'] }, { required: ['content', 'json'] }, { required: ['html', 'json'] }],
        },
      },
      {
        if: { properties: { kind: { const: 'inline' } }, required: ['kind'] },
        then: { not: { anyOf: [{ required: ['html'] }, { required: ['json'] }] } },
      },
      {
        if: { required: ['inline'] },
        then: { properties: { kind: { const: 'inline' } }, required: ['content'] },
      },
    ]);
    expect(contentControlInfo.properties).toHaveProperty('selectionTarget');
    expect(contentControlInfo.properties).toHaveProperty('isEmpty', { type: 'boolean' });
  });

  it('publishes cached field insert inputs in the contract schema', () => {
    const schemas = buildInternalContractSchemas();
    const fieldsInsertInput = schemas.operations['fields.insert'].input as {
      properties?: {
        mode?: { const?: string };
        at?: { $ref?: string };
        instruction?: { type?: string };
        cachedResultText?: { type?: string };
        updatePolicy?: { enum?: string[] };
      };
      required?: string[];
      additionalProperties?: boolean;
    };

    expect(fieldsInsertInput.properties?.mode?.const).toBe('raw');
    expect(fieldsInsertInput.properties?.at?.$ref).toBe('#/$defs/TextTarget');
    expect(fieldsInsertInput.properties?.instruction?.type).toBe('string');
    expect(fieldsInsertInput.properties?.cachedResultText?.type).toBe('string');
    expect(fieldsInsertInput.properties?.updatePolicy?.enum).toEqual(['rebuild', 'preserveCached']);
    expect(fieldsInsertInput.required).toEqual(['mode', 'at', 'instruction']);
    expect(fieldsInsertInput.additionalProperties).toBe(false);
  });

  it('publishes CommentTrackedChangeLink in shared defs for comments get/list outputs', () => {
    const schemas = buildInternalContractSchemas();
    const sharedLink = schemas.$defs?.CommentTrackedChangeLink as {
      properties?: { trackedChangeType?: { enum?: string[] } };
    };
    const commentsGetOutput = schemas.operations['comments.get'].output as {
      properties?: { trackedChangeLink?: { oneOf?: Array<{ $ref?: string; type?: string }> } };
    };
    const commentsListOutput = schemas.operations['comments.list'].output as {
      properties?: {
        items?: {
          items?: {
            properties?: {
              trackedChangeLink?: { oneOf?: Array<{ $ref?: string; type?: string }> };
            };
          };
        };
      };
    };
    const getVariants = commentsGetOutput.properties?.trackedChangeLink?.oneOf ?? [];
    const listVariants = commentsListOutput.properties?.items?.items?.properties?.trackedChangeLink?.oneOf ?? [];

    expect(sharedLink.properties?.trackedChangeType?.enum).toEqual([
      'insertion',
      'deletion',
      'replacement',
      'formatting',
      'move',
      'structural',
      'insert',
      'delete',
      'format',
    ]);
    expect(getVariants.some((variant) => variant.$ref === '#/$defs/CommentTrackedChangeLink')).toBe(true);
    expect(listVariants.some((variant) => variant.$ref === '#/$defs/CommentTrackedChangeLink')).toBe(true);
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
    expect(schema.properties?.trackedChangeDisplayType).toEqual({ type: ['string', 'null'] });
    expect(schema.properties?.trackedChangeStory).toEqual({
      oneOf: [{ $ref: '#/$defs/StoryLocator' }, { type: 'null' }],
    });
    expect(schema.properties?.trackedChangeAnchorKey).toEqual({ type: ['string', 'null'] });
    for (const field of ['trackedChangeDisplayType', 'trackedChangeStory', 'trackedChangeAnchorKey'])
      expect(schema.required).not.toContain(field);
    expect(schema.additionalProperties).toBe(false);
    expect(collectUnknownPropertySchemaErrors(schema, { ...link, unsupportedLinkMetadata: 'must reject' })).toEqual([
      '$.unsupportedLinkMetadata: unknown property',
    ]);
  });

  it('preserves the broad public SDFragment union for structural insert content', () => {
    const schemas = buildInternalContractSchemas();
    const insertInput = schemas.operations.insert.input as { oneOf?: Array<{ properties?: Record<string, unknown> }> };
    const structuralVariant = insertInput.oneOf!.find((v) => v.properties?.content)!;
    const contentSchema = structuralVariant.properties!.content as ContractTestSchemaShape;

    expectBroadSDFragmentSchema(contentSchema);
    expect(
      collectUnknownPropertySchemaErrors(contentSchema.oneOf?.[0], {
        kind: 'image',
        image: { source: { kind: 'media', mediaId: 'rId1' } },
      }),
    ).toEqual([]);
  });

  it('preserves the broad public SDFragment union for structural replace content', () => {
    const schemas = buildInternalContractSchemas();
    const replaceInput = schemas.operations.replace.input as {
      oneOf?: Array<{ oneOf?: Array<{ properties?: Record<string, unknown> }> }>;
    };
    const structuralBranch = replaceInput.oneOf![6] as { oneOf?: Array<{ properties?: Record<string, unknown> }> };

    for (const variant of structuralBranch.oneOf!) {
      expectBroadSDFragmentSchema(variant.properties!.content as ContractTestSchemaShape);
    }
  });

  it('accepts both legacy content and structured body for footnotes.insert', () => {
    const schemas = buildInternalContractSchemas();
    const insertInput = schemas.operations['footnotes.insert'].input as {
      oneOf?: Array<{ properties?: Record<string, unknown>; required?: string[] }>;
    };

    expect(Array.isArray(insertInput.oneOf)).toBe(true);
    expect(insertInput.oneOf).toHaveLength(2);

    const [contentVariant, bodyVariant] = insertInput.oneOf!;
    expect(Object.keys(contentVariant.properties ?? {}).sort()).toEqual(['at', 'content', 'type']);
    expect(contentVariant.required).toEqual(['type', 'content']);

    expect(Object.keys(bodyVariant.properties ?? {}).sort()).toEqual(['at', 'body', 'type']);
    expect(bodyVariant.required).toEqual(['type', 'body']);

    expectBroadSDFragmentSchema(bodyVariant.properties!.body as ContractTestSchemaShape);
  });

  it('accepts structured body patches for footnotes.update', () => {
    const schemas = buildInternalContractSchemas();
    const updateInput = schemas.operations['footnotes.update'].input as {
      properties?: { patch?: { oneOf?: Array<{ properties?: Record<string, unknown>; required?: string[] }> } };
    };
    const patchVariants = updateInput.properties?.patch?.oneOf ?? [];

    expect(patchVariants).toHaveLength(3);

    const bodyVariant = patchVariants.find((variant) =>
      Object.prototype.hasOwnProperty.call(variant.properties ?? {}, 'body'),
    );
    expect(bodyVariant).toBeDefined();
    expect(bodyVariant?.required).toEqual(['body']);

    expectBroadSDFragmentSchema(bodyVariant?.properties?.body as ContractTestSchemaShape);
  });

  it('allows null trackedChangeLink on comment read models', () => {
    const schemas = buildInternalContractSchemas();
    const commentInfoSchema = schemas.operations['comments.get'].output as {
      properties?: {
        trackedChangeLink?: { oneOf?: Array<Record<string, unknown>> };
      };
    };
    const commentsListSchema = schemas.operations['comments.list'].output as {
      properties?: {
        items?: {
          items?: {
            properties?: {
              trackedChangeLink?: { oneOf?: Array<Record<string, unknown>> };
            };
          };
        };
      };
    };

    const getVariants = commentInfoSchema.properties?.trackedChangeLink?.oneOf ?? [];
    const listVariants = commentsListSchema.properties?.items?.items?.properties?.trackedChangeLink?.oneOf ?? [];

    expect(getVariants.some((variant) => variant.type === 'null')).toBe(true);
    expect(listVariants.some((variant) => variant.type === 'null')).toBe(true);
  });

  it('publishes explicit tracked-change conversation provenance independently of spatial linkage', () => {
    const schemas = buildInternalContractSchemas();
    const getProperties = (schemas.operations['comments.get'].output as { properties?: Record<string, unknown> })
      .properties;
    const listProperties = (
      schemas.operations['comments.list'].output as {
        properties?: { items?: { items?: { properties?: Record<string, unknown> } } };
      }
    ).properties?.items?.items?.properties;

    expect(getProperties).toHaveProperty('trackedChangeParentId');
    expect(getProperties).toHaveProperty('trackedChangeThreadParentId');
    expect(listProperties).toHaveProperty('trackedChangeParentId');
    expect(listProperties).toHaveProperty('trackedChangeThreadParentId');
  });

  it('publishes replacement in comment tracked-change enums for get/list and link defs', () => {
    const schemas = buildInternalContractSchemas();
    const commentInfoSchema = schemas.operations['comments.get'].output as {
      properties?: {
        trackedChangeType?: {
          enum?: string[];
        };
      };
    };
    const commentsListSchema = schemas.operations['comments.list'].output as {
      properties?: {
        items?: {
          items?: {
            properties?: {
              trackedChangeType?: {
                enum?: string[];
              };
            };
          };
        };
      };
    };
    const defs = schemas.$defs as Record<
      string,
      {
        properties?: Record<
          string,
          {
            enum?: string[];
          }
        >;
      }
    >;

    expect(commentInfoSchema.properties?.trackedChangeType?.enum).toEqual(
      expect.arrayContaining(['insert', 'delete', 'replacement', 'format']),
    );
    expect(commentsListSchema.properties?.items?.items?.properties?.trackedChangeType?.enum).toEqual(
      expect.arrayContaining(['insert', 'delete', 'replacement', 'format']),
    );
    expect(defs.CommentTrackedChangeLink?.properties?.trackedChangeType?.enum).toEqual(
      expect.arrayContaining(['insert', 'delete', 'replacement', 'format']),
    );
  });

  it('publishes the create id alias, durable external identity, authorship, and metadata', () => {
    const schemas = buildInternalContractSchemas();
    const createProperties = (
      schemas.operations['comments.create'].input as {
        properties?: Record<string, unknown>;
      }
    ).properties;
    const getProperties = (
      schemas.operations['comments.get'].output as {
        properties?: Record<string, unknown>;
      }
    ).properties;
    const listProperties = (
      schemas.operations['comments.list'].output as {
        properties?: { items?: { items?: { properties?: Record<string, unknown> } } };
      }
    ).properties?.items?.items?.properties;

    expect(createProperties).toEqual(
      expect.objectContaining({
        commentId: expect.any(Object),
        externalId: expect.any(Object),
        author: expect.any(Object),
        authorId: expect.any(Object),
        authorEmail: expect.any(Object),
        authorImage: expect.any(Object),
        metadata: expect.any(Object),
      }),
    );
    for (const properties of [getProperties, listProperties]) {
      expect(properties).toEqual(
        expect.objectContaining({
          externalId: expect.any(Object),
          metadata: expect.any(Object),
          creatorId: expect.any(Object),
          creatorEmail: expect.any(Object),
          creatorImage: expect.any(Object),
        }),
      );
    }
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
    for (const output of [
      schemas.operations['comments.get'].output,
      (schemas.operations['comments.list'].output as ContractTestSchemaShape).properties!.items.items!,
    ]) {
      const properties = (output as ContractTestSchemaShape).properties!;
      for (const name of ['commentId', 'rootCommentId', 'replyCount', 'origin', 'imported'])
        expect(properties).toHaveProperty(name);
    }
  });

  it('declares rich tracked-change targets and review metadata for typed consumers', () => {
    const schemas = buildInternalContractSchemas();
    const get = schemas.operations['trackChanges.get'].output as ContractTestSchemaShape;
    const list = (schemas.operations['trackChanges.list'].output as ContractTestSchemaShape).properties!.items.items!;
    for (const schema of [get, list]) {
      const properties = schema.properties!;
      for (const name of [
        'target',
        'navigationTarget',
        'structuralDescriptor',
        'splitFromId',
        'move',
        'moveDirection',
        'linkedComments',
        'imagePreview',
      ])
        expect(properties).toHaveProperty(name);
      expect(
        properties.target.oneOf!.map((branch) => branch.properties!.kind.const ?? branch.properties!.kind.enum![0]),
      ).toEqual(['text', 'replacement', 'formatting', 'structural', 'move']);
      expect(properties.structuralDescriptor.required).toEqual([
        'operation',
        'granularity',
        'decisionPolicy',
        'before',
        'after',
        'affectedStories',
        'sourceIds',
        'exportCarrier',
      ]);
      expect(properties.move.properties!.source.oneOf!.some((branch) => branch.type === 'null')).toBe(true);
      expect(properties.navigationTarget.required).toEqual(['kind', 'story', 'blockId', 'role']);
      expect(properties.imagePreview.required).toEqual(['src', 'contentType', 'role']);
    }
    expect(get.properties!.before.properties).toHaveProperty('structural');
    expect(get.properties!.after.properties).toHaveProperty('structural');
  });

  it('keeps enriched text/replacement target coordinates optional and closed', () => {
    const schemas = buildInternalContractSchemas();
    const output = schemas.operations['trackChanges.get'].output as ContractTestSchemaShape;
    for (const kind of ['text', 'replacement']) {
      const branch = output.properties!.target.oneOf!.find((value) => value.properties!.kind.enum?.[0] === kind)!;
      expect(branch.properties!.coordinateSpace).toEqual({ $ref: '#/$defs/TextCoordinateSpace' });
      expect(branch.required).not.toContain('coordinateSpace');
      expect(branch.additionalProperties).toBe(false);
    }
    expect(schemas.$defs!.TextCoordinateSpace).toEqual({ enum: ['visible', 'tracked'] });
  });

  it('requires id on comments.create success receipts', () => {
    const schemas = buildInternalContractSchemas();
    const createOutputSchema = schemas.operations['comments.create'].output as {
      oneOf?: Array<{
        $ref?: string;
      }>;
    };
    const defs = schemas.$defs as Record<
      string,
      {
        properties?: Record<string, unknown>;
        required?: string[];
      }
    >;

    const successSchema = createOutputSchema.oneOf?.[0];
    expect(successSchema?.$ref).toBe('#/$defs/CommentsCreateSuccess');
    expect(defs.CommentsCreateSuccess?.properties).toHaveProperty('id');
    expect(defs.CommentsCreateSuccess?.required).toEqual(expect.arrayContaining(['success', 'id']));
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

  it('declares UNSUPPORTED_ENVIRONMENT for insert metadata and generated failure schema', () => {
    const schemas = buildInternalContractSchemas();
    const insertFailureSchema = schemas.operations.insert.failure as {
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

    expect(COMMAND_CATALOG.insert.possibleFailureCodes).toContain('UNSUPPORTED_ENVIRONMENT');
    expect(insertFailureSchema.properties?.failure?.properties?.code?.enum).toContain('UNSUPPORTED_ENVIRONMENT');
  });

  it('describes every rich insert and replace runtime failure field', () => {
    const schemas = buildInternalContractSchemas();
    for (const operationId of ['insert', 'replace'] as const) {
      const failureSchema = schemas.operations[operationId].failure as {
        properties?: {
          failure?: {
            properties?: {
              code?: { enum?: string[] };
              path?: ContractTestSchemaShape;
              target?: ContractTestSchemaShape;
            };
          };
        };
      };
      const properties = failureSchema.properties?.failure?.properties;
      expectArrayToIncludeValues(
        properties?.code?.enum,
        ['TARGET_NOT_FOUND', 'PRECONDITION_FAILED', 'REVISION_MISMATCH', 'INTERNAL_ERROR'],
        `${operationId} failure schema enum`,
      );
      expect(properties?.path).toEqual({
        type: 'array',
        items: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      });
      const expectedTargets: ContractTestSchemaShape[] = [
        { $ref: '#/$defs/BlockNodeAddress' },
        { $ref: '#/$defs/TextAddress' },
        { $ref: '#/$defs/SelectionTarget' },
      ];
      expectedTargets.push({
        type: 'object',
        properties: { kind: { const: 'story' }, storyType: { const: 'body' } },
        required: ['kind', 'storyType'],
        additionalProperties: false,
      });
      expect(properties?.target?.oneOf).toEqual(expectedTargets);
    }
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

  it('publishes the full setFlowOptions paragraph flow booleans in the contract input schema', () => {
    const schemas = buildInternalContractSchemas();
    const setFlowOptionsInput = schemas.operations['format.paragraph.setFlowOptions'].input as {
      properties?: Record<string, { type?: string }>;
      anyOf?: Array<{ required?: string[] }>;
    };

    expect(setFlowOptionsInput.properties?.contextualSpacing?.type).toBe('boolean');
    expect(setFlowOptionsInput.properties?.pageBreakBefore?.type).toBe('boolean');
    expect(setFlowOptionsInput.properties?.suppressAutoHyphens?.type).toBe('boolean');
    expect(setFlowOptionsInput.properties?.autoSpaceDE?.type).toBe('boolean');
    expect(setFlowOptionsInput.properties?.autoSpaceDN?.type).toBe('boolean');
    expect(setFlowOptionsInput.properties?.adjustRightInd?.type).toBe('boolean');
    expect(setFlowOptionsInput.properties?.snapToGrid?.type).toBe('boolean');

    const requiredSets = new Set(
      (setFlowOptionsInput.anyOf ?? []).map((variant) => variant.required?.join('|') ?? '').filter(Boolean),
    );
    expect(requiredSets).toEqual(
      new Set([
        'target|contextualSpacing',
        'target|pageBreakBefore',
        'target|suppressAutoHyphens',
        'target|autoSpaceDE',
        'target|autoSpaceDN',
        'target|adjustRightInd',
        'target|snapToGrid',
      ]),
    );
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

  it('publishes replacement as a first-class tracked-change type in list/get/extract schemas', () => {
    const schemas = buildInternalContractSchemas();
    const trackChangesListInput = schemas.operations['trackChanges.list'].input as {
      properties?: {
        type?: {
          enum?: string[];
        };
      };
    };
    const trackChangesGetOutput = schemas.operations['trackChanges.get'].output as {
      properties?: {
        type?: {
          enum?: string[];
        };
        grouping?: {
          enum?: string[];
        };
      };
    };
    const extractOutput = schemas.operations.extract.output as {
      properties?: {
        trackedChanges?: {
          items?: {
            properties?: {
              type?: {
                enum?: string[];
              };
            };
          };
        };
      };
    };

    expect(trackChangesListInput.properties?.type?.enum).toEqual(
      expect.arrayContaining(['insert', 'delete', 'replacement', 'format']),
    );
    expect(trackChangesGetOutput.properties?.type?.enum).toEqual(
      expect.arrayContaining(['insert', 'delete', 'replacement', 'format']),
    );
    expect(trackChangesGetOutput.properties?.grouping?.enum).toEqual(
      expect.arrayContaining(['standalone', 'replacement-pair', 'unknown']),
    );
    expect(trackChangesGetOutput.properties?.grouping?.enum).not.toContain('aggregate');
    expect(extractOutput.properties?.trackedChanges?.items?.properties?.type?.enum).toEqual(
      expect.arrayContaining(['insert', 'delete', 'replacement', 'format']),
    );
  });

  it('publishes the structured list semantic delta facts on trackChanges.get/list output schemas and keeps them closed (TC-LIST-003/004)', () => {
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
      expect(surface).toBeDefined();
      const memberDelta = surface!.properties?.listDeltas?.items;
      expect(memberDelta?.properties?.kind?.enum).toEqual([
        'list-add',
        'list-remove',
        'list-level',
        'list-style',
        'list-restart',
        'indent',
        'other-format',
      ]);
      // The new fields are accepted while the schemas stay CLOSED: unknown
      // fields on the row, the member delta, its sides, and the summary
      // counts are all still rejected.
      expect(surface!.additionalProperties).toBe(false);
      expect(memberDelta?.additionalProperties).toBe(false);
      expect(memberDelta?.required).toEqual(['kind', 'from', 'to']);
      expect(memberDelta?.properties?.from?.additionalProperties).toBe(false);
      const summary = surface!.properties?.listDeltaSummary;
      expect(summary?.additionalProperties).toBe(false);
      expect(summary?.properties?.counts?.additionalProperties).toBe(false);
      expect(surface!.properties?.targetIsListItem?.type).toBe('boolean');
      expect(surface!.properties?.listActionKind?.enum).toEqual(['merge-items']);

      expect(collectUnknownPropertySchemaErrors(surface, validListFactPayload)).toEqual([]);
      for (const payload of unknownFieldPayloads) {
        expect(collectUnknownPropertySchemaErrors(surface, payload).length).toBeGreaterThan(0);
      }
    }
  });

  it('publishes closed custom tracked-change attributes on list and get', () => {
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
      const attribute = surface?.properties?.customAttributes?.items;
      expect(attribute?.additionalProperties).toBe(false);
      expect(attribute?.required).toEqual(['name', 'namespaceUri', 'localName', 'value']);
      expect(collectUnknownPropertySchemaErrors(surface, { customAttributes: value })).toEqual([]);
      expect(
        collectUnknownPropertySchemaErrors(surface, {
          customAttributes: [{ ...value[0], unexpected: true }],
        }),
      ).toHaveLength(1);
    }
  });

  it('includes global.history in capabilities.get output schema', () => {
    const schemas = buildInternalContractSchemas();
    const capabilitiesOutput = schemas.operations['capabilities.get'].output as {
      properties?: {
        global?: {
          properties?: Record<string, unknown>;
          required?: string[];
        };
      };
    };

    expect(capabilitiesOutput.properties?.global?.properties).toHaveProperty('history');
    expect(capabilitiesOutput.properties?.global?.required).toContain('history');
  });

  it('derives structured capability reason codes from the public reason vocabulary', () => {
    const output = buildInternalContractSchemas().operations['capabilities.resolve'].output as {
      properties?: {
        tracked?: {
          oneOf?: Array<{ properties?: { code?: { enum?: string[] } } }>;
        };
      };
    };
    expect(output.properties?.tracked?.oneOf?.[1]?.properties?.code?.enum).toEqual([...CAPABILITY_REASON_CODES]);
  });

  it('narrows table operation address schemas to table-specific refs', () => {
    const schemas = buildInternalContractSchemas();

    const tablesGetInput = schemas.operations['tables.get'].input as {
      properties?: { target?: { $ref?: string } };
    };
    const tablesGetOutput = schemas.operations['tables.get'].output as {
      properties?: { address?: { $ref?: string } };
    };
    const unmergeInput = schemas.operations['tables.unmergeCells'].input as {
      oneOf?: Array<Record<string, unknown>>;
    };
    const setBorderInput = schemas.operations['tables.setBorder'].input as {
      properties?: { target?: { $ref?: string } };
    };
    const insertRowSuccess = schemas.operations['tables.insertRow'].success as {
      properties?: { table?: { $ref?: string } };
    };

    expect(tablesGetInput.properties?.target?.$ref).toBe('#/$defs/TableAddress');
    expect(tablesGetOutput.properties?.address?.$ref).toBe('#/$defs/TableAddress');

    // unmergeCells input is a oneOf: [cellLocator, tableScopedCellLocator (target), tableScopedCellLocator (nodeId)]
    expect(unmergeInput.oneOf).toHaveLength(3);
    const [cellBranch, tableTargetBranch, tableNodeIdBranch] = unmergeInput.oneOf as Array<{
      properties?: { target?: { $ref?: string }; nodeId?: unknown; rowIndex?: unknown; columnIndex?: unknown };
      required?: string[];
    }>;
    // First branch: direct cell locator (target.$ref → TableCellAddress)
    expect(cellBranch.properties?.target?.$ref).toBe('#/$defs/TableCellAddress');
    // Second branch: table-scoped with target (target.$ref → TableAddress + coordinates)
    expect(tableTargetBranch.properties?.target?.$ref).toBe('#/$defs/TableAddress');
    expect(tableTargetBranch.required).toContain('rowIndex');
    expect(tableTargetBranch.required).toContain('columnIndex');
    // Third branch: table-scoped with nodeId + coordinates
    expect(tableNodeIdBranch.properties?.nodeId).toBeDefined();
    expect(tableNodeIdBranch.required).toContain('nodeId');
    expect(tableNodeIdBranch.required).toContain('rowIndex');
    expect(tableNodeIdBranch.required).toContain('columnIndex');

    expect(setBorderInput.properties?.target?.$ref).toBe('#/$defs/TableOrCellAddress');
    expect(insertRowSuccess.properties?.table?.$ref).toBe('#/$defs/TableAddress');
  });

  it('allows tables.setStyle to omit styleId for clear-style parity', () => {
    const schemas = buildInternalContractSchemas();
    const setStyleInput = schemas.operations['tables.setStyle'].input as {
      properties?: { styleId?: { type?: string } };
      required?: string[];
      oneOf?: Array<{ required?: string[] }>;
    };

    expect(setStyleInput.properties?.styleId?.type).toBe('string');
    expect(setStyleInput.required ?? []).not.toContain('styleId');
    expect(setStyleInput.oneOf).toEqual([{ required: ['target'] }, { required: ['nodeId'] }]);
  });

  it('requires at least one tables.sort key', () => {
    const schemas = buildInternalContractSchemas();
    const sortInput = schemas.operations['tables.sort'].input as {
      properties?: { keys?: { type?: string; minItems?: number } };
    };

    expect(sortInput.properties?.keys?.type).toBe('array');
    expect(sortInput.properties?.keys?.minItems).toBe(1);
  });

  it('preserves row-locator constraints in row operation schemas', () => {
    const schemas = buildInternalContractSchemas();
    const insertRowInput = schemas.operations['tables.insertRow'].input as {
      oneOf?: Array<{
        properties?: {
          target?: { $ref?: string };
          nodeId?: { type?: string };
          rowIndex?: { type?: string; minimum?: number };
          position?: { enum?: string[] };
        };
        required?: string[];
      }>;
    };
    const deleteRowInput = schemas.operations['tables.deleteRow'].input as {
      oneOf?: Array<{
        properties?: {
          target?: { $ref?: string };
          nodeId?: { type?: string };
          rowIndex?: { type?: string; minimum?: number };
        };
        required?: string[];
      }>;
    };

    // 1–3: scoped variants. 4: SD-2540 append-at-end shorthand
    // (table-level target with no rowIndex/position).
    expect(insertRowInput.oneOf).toHaveLength(4);
    expect(insertRowInput.oneOf?.[0]?.properties?.target?.$ref).toBe('#/$defs/TableRowAddress');
    expect(insertRowInput.oneOf?.[0]?.required).toEqual(['target', 'position']);
    expect(insertRowInput.oneOf?.[1]?.properties?.target?.$ref).toBe('#/$defs/TableAddress');
    expect(insertRowInput.oneOf?.[1]?.required).toEqual(['target', 'rowIndex', 'position']);
    expect(insertRowInput.oneOf?.[2]?.properties?.rowIndex).toEqual({ type: 'integer', minimum: 0 });
    expect(insertRowInput.oneOf?.[2]?.required).toEqual(['nodeId', 'rowIndex', 'position']);
    // Append-at-end variant: target OR nodeId, no rowIndex, no position.
    // Uses an inner oneOf for target/nodeId and a `not` clause to forbid
    // rowIndex/position; no top-level `required` array.
    const appendVariant = insertRowInput.oneOf?.[3] as {
      properties?: { target?: { $ref?: string }; nodeId?: { type?: string } };
      oneOf?: Array<{ required?: string[] }>;
      not?: { anyOf?: Array<{ required?: string[] }> };
    };
    expect(appendVariant?.properties?.target?.$ref).toBe('#/$defs/TableAddress');
    expect(appendVariant?.properties?.nodeId?.type).toBe('string');
    expect(appendVariant?.oneOf).toEqual([{ required: ['target'] }, { required: ['nodeId'] }]);
    expect(appendVariant?.not?.anyOf).toEqual([{ required: ['rowIndex'] }, { required: ['position'] }]);

    expect(deleteRowInput.oneOf).toHaveLength(3);
    expect(deleteRowInput.oneOf?.[0]?.properties?.target?.$ref).toBe('#/$defs/TableRowAddress');
    expect(deleteRowInput.oneOf?.[0]?.required).toEqual(['target']);
    expect(deleteRowInput.oneOf?.[1]?.properties?.target?.$ref).toBe('#/$defs/TableAddress');
    expect(deleteRowInput.oneOf?.[1]?.required).toEqual(['target', 'rowIndex']);
    expect(deleteRowInput.oneOf?.[2]?.properties?.nodeId?.type).toBe('string');
    expect(deleteRowInput.oneOf?.[2]?.properties?.rowIndex).toEqual({ type: 'integer', minimum: 0 });
    expect(deleteRowInput.oneOf?.[2]?.required).toEqual(['nodeId', 'rowIndex']);
  });

  it('declares images.setZOrder.relativeHeight as unsigned 32-bit integer', () => {
    const schemas = buildInternalContractSchemas();
    const inputSchema = schemas.operations['images.setZOrder'].input as {
      properties?: {
        zOrder?: {
          properties?: {
            relativeHeight?: {
              type?: string;
              minimum?: number;
              maximum?: number;
            };
          };
        };
      };
    };

    const relativeHeightSchema = inputSchema.properties?.zOrder?.properties?.relativeHeight;
    expect(relativeHeightSchema?.type).toBe('integer');
    expect(relativeHeightSchema?.minimum).toBe(Z_ORDER_RELATIVE_HEIGHT_MIN);
    expect(relativeHeightSchema?.maximum).toBe(Z_ORDER_RELATIVE_HEIGHT_MAX);
  });

  it('derives OPERATION_IDS from OPERATION_DEFINITIONS keys', () => {
    const definitionKeys = Object.keys(OPERATION_DEFINITIONS).sort();
    const operationIds = [...OPERATION_IDS].sort();
    expect(definitionKeys).toEqual(operationIds);
  });

  it('ensures every definition entry has a valid referenceGroup', () => {
    const validGroups: readonly ReferenceGroupKey[] = [
      'core',
      'blocks',
      'capabilities',
      'create',
      'sections',
      'format',
      'format.paragraph',
      'styles',
      'styles.paragraph',
      'templates',
      'lists',
      'comments',
      'trackChanges',
      'query',
      'mutations',
      'tables',
      'history',
      'toc',
      'images',
      'hyperlinks',
      'headerFooters',
      'watermarks',
      'contentControls',
      'bookmarks',
      'footnotes',
      'clipboard',
      'crossRefs',
      'index',
      'captions',
      'fields',
      'citations',
      'authorities',
      'clipboard',
      'ranges',
      'selection',
      'diff',
      'export',
      'protection',
      'permissionRanges',
      'customXml',
      'metadata',
    ];
    for (const id of OPERATION_IDS) {
      expect(validGroups, `${id} has invalid referenceGroup`).toContain(OPERATION_DEFINITIONS[id].referenceGroup);
    }
  });

  it('projects COMMAND_CATALOG metadata from the same objects in OPERATION_DEFINITIONS', () => {
    for (const id of OPERATION_IDS) {
      expect(COMMAND_CATALOG[id]).toBe(OPERATION_DEFINITIONS[id].metadata);
    }
  });

  it('projects member paths that match OPERATION_DEFINITIONS', () => {
    for (const id of OPERATION_IDS) {
      expect(OPERATION_MEMBER_PATH_MAP[id]).toBe(OPERATION_DEFINITIONS[id].memberPath);
    }
  });

  it('projects reference doc paths that match OPERATION_DEFINITIONS', () => {
    for (const id of OPERATION_IDS) {
      expect(OPERATION_REFERENCE_DOC_PATH_MAP[id]).toBe(OPERATION_DEFINITIONS[id].referenceDocPath);
    }
  });

  it('projects descriptions that match OPERATION_DEFINITIONS', () => {
    for (const id of OPERATION_IDS) {
      expect(OPERATION_DESCRIPTION_MAP[id]).toBe(OPERATION_DEFINITIONS[id].description);
    }
  });

  it('projects expected results that match OPERATION_DEFINITIONS', () => {
    for (const id of OPERATION_IDS) {
      expect(OPERATION_EXPECTED_RESULT_MAP[id]).toBe(OPERATION_DEFINITIONS[id].expectedResult);
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

  it('marks exactly the Promise-returning operations as async', () => {
    const asyncOps = OPERATION_IDS.filter((id) => COMMAND_CATALOG[id].returnsPromise === true).sort();
    expect(asyncOps).toEqual([
      'capabilities.check',
      'mutations.beginTemporary',
      'mutations.commitTemporary',
      'mutations.replaceTemporary',
      'mutations.rollbackTemporary',
      'projectHtml',
      'projectMarkdown',
      'templates.apply',
    ]);

    // returnsPromise is a strict boolean signal: it is either true or absent.
    for (const id of OPERATION_IDS) {
      const value = COMMAND_CATALOG[id].returnsPromise;
      expect(value === true || value === undefined, `${id} returnsPromise must be true or undefined`).toBe(true);
    }
  });
});

describe('temporary mutation receipts', () => {
  it.each(['mutations.beginTemporary', 'mutations.replaceTemporary', 'mutations.commitTemporary'] as const)(
    'publishes per-operation effects on %s success',
    (operationId) => {
      const success = buildInternalContractSchemas().operations[operationId].success as ContractTestSchemaShape;
      expect(success.properties?.operationEffects).toEqual({
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: { inserted: { type: 'array', items: { $ref: '#/$defs/EntityAddress' } } },
          additionalProperties: false,
          required: ['inserted'],
        },
      });
      expect(success.required).not.toContain('operationEffects');
    },
  );
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

  it('uses the public tracked-change vocabulary for aggregate and span extraction without opening objects', () => {
    const schema = buildInternalContractSchemas().operations.extract.output as ContractTestSchemaShape;
    const change = schema.properties!.trackedChanges!.items!;
    const mark = schema.properties!.blocks!.items!.properties!.textSpans!.items!.properties!.trackedChanges!.items!;
    const types = [
      'insertion',
      'deletion',
      'replacement',
      'formatting',
      'move',
      'structural',
      'insert',
      'delete',
      'format',
    ];
    expect(change.properties!.type!.enum).toEqual(types);
    expect(mark.properties!.type!.enum).toEqual(types);
    expect(change.additionalProperties).toBe(false);
    expect(mark.additionalProperties).toBe(false);
    expect(
      collectUnknownPropertySchemaErrors(change, { entityId: 'change-1', type: 'insertion', unexpected: true }),
    ).toContain('$.unexpected: unknown property');
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
    const schemas = buildInternalContractSchemas();
    const defs = schemas.$defs as Record<string, ContractTestSchemaShape>;
    const success = defs.ReceiptSuccess;
    expect(schemas.operations.clearContent.success).toEqual({ $ref: '#/$defs/ReceiptSuccess' });
    expect(collectUnknownPropertySchemaErrors(success, { success: true, status: 'NO_OP' })).toEqual([]);
    expect(success.properties?.status).toEqual({ const: 'NO_OP' });
    expect(success.required).not.toContain('status');
    expect(success.additionalProperties).toBe(false);
    expect(collectUnknownPropertySchemaErrors(success, { success: true, unexpected: true })).toEqual([
      '$.unexpected: unknown property',
    ]);
  });

  it('declares optional physical shifts and replay identities on their runtime receipt surfaces', () => {
    const schemas = buildInternalContractSchemas();
    const defs = schemas.$defs as Record<string, ContractTestSchemaShape>;
    expect(defs.TrackedTextRangeShift).toEqual({
      type: 'object',
      properties: {
        story: { $ref: '#/$defs/StoryLocator' },
        blockId: { type: 'string' },
        atCharInBlock: { type: 'integer' },
        delta: { type: 'integer' },
      },
      required: ['story', 'blockId', 'atCharInBlock', 'delta'],
      additionalProperties: false,
    });
    expect(defs.HistoryReplay).toEqual({
      type: 'object',
      properties: {
        txId: { type: 'string' },
        direction: { enum: ['undo', 'redo'] },
        txIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['txId', 'direction'],
      additionalProperties: false,
    });
    expect(defs.TextRangeShift.properties?.replacedLength).toEqual({ type: 'integer', minimum: 1 });
    expect(defs.TextRangeShift.required).not.toContain('replacedLength');
    const physicalShifts = { type: 'array', items: { $ref: '#/$defs/TrackedTextRangeShift' } };
    for (const receipt of [
      defs.ReceiptSuccess,
      defs.TextMutationSuccess,
      schemas.operations['history.undo'].success as ContractTestSchemaShape,
      schemas.operations['history.redo'].success as ContractTestSchemaShape,
    ]) {
      expect(receipt.properties?.trackedTextRangeShifts).toEqual(physicalShifts);
      expect(receipt.properties?.history).toEqual({ $ref: '#/$defs/HistoryReplay' });
      expect(receipt.required).not.toContain('trackedTextRangeShifts');
      expect(receipt.required).not.toContain('history');
    }
    for (const id of ['insert', 'replace'] as const) {
      const success = schemas.operations[id].success as ContractTestSchemaShape;
      const failure = schemas.operations[id].failure as ContractTestSchemaShape;
      expect(success.properties?.trackedTextRangeShifts).toEqual(physicalShifts);
      expect(success.required).not.toContain('trackedTextRangeShifts');
      expect(success.properties).not.toHaveProperty('history');
      expect(failure.properties).not.toHaveProperty('trackedTextRangeShifts');
      expect(failure.properties).not.toHaveProperty('history');
    }
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
    expect(defs.TextMutationSuccess.properties?.resolution?.$ref).toBe('#/$defs/TextMutationResolution');
    expect(defs.TextMutationSuccess.required).toEqual(['success', 'resolution']);
    expect(defs.TextMutationSuccess.properties?.trackedChangeOutcomes?.items?.additionalProperties).toBe(false);
    for (const id of ['blocks.split', 'blocks.merge'] as const) {
      const success = schemas.operations[id].success as ContractTestSchemaShape;
      expect(success.properties?.anchor).toBeDefined();
      expect(success.properties?.trackedChangeRefs).toBeDefined();
    }
    expect((schemas.operations['blocks.merge'].success as ContractTestSchemaShape).properties?.joinOffset).toEqual({
      type: 'integer',
      minimum: 0,
    });
    expect(
      (schemas.operations['contentControls.insertAfter'].success as ContractTestSchemaShape).properties?.createdBlockId,
    ).toEqual({ type: 'string' });
    const hyperlink = schemas.operations['hyperlinks.insert'].success as ContractTestSchemaShape;
    for (const field of ['hyperlinkNodeId', 'partsCreated', 'partsModified', 'createdRId'])
      expect(hyperlink.properties, field).toHaveProperty(field);
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
    expect(schema.required).toEqual(['success', 'plan', 'diagnostics']);
    expect(schema.properties?.plan?.additionalProperties).toBe(false);
    expect(schema.properties?.diagnostics?.items?.additionalProperties).toBe(false);
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

  it('keeps nonempty discovery items closed with identity and handles and types reader metadata', () => {
    const schemas = buildInternalContractSchemas();
    for (const id of ['watermarks.list', 'hyperlinks.list'] as const) {
      const output = schemas.operations[id].output as ContractTestSchemaShape;
      const item = output.properties?.items?.items;
      expect(item?.required).toContain('id');
      expect(item?.required).toContain('handle');
      expect(item?.properties?.handle?.$ref).toBe('#/$defs/ResolvedHandle');
      expect(item?.additionalProperties).toBe(false);
      expect(collectUnknownPropertySchemaErrors(item, { unknownDiscoveryField: true })).toContain(
        '$.unknownDiscoveryField: unknown property',
      );
      expect(output.required).toEqual(['evaluatedRevision', 'total', 'items', 'page']);
    }
    const capability = (schemas.operations['capabilities.get'].output as ContractTestSchemaShape).properties?.operations
      ?.properties?.['format.apply'];
    expect(capability?.properties?.trackedSupport?.enum).toEqual(['always', 'conditional', 'never']);
    const toc = schemas.operations['toc.get'].output as ContractTestSchemaShape;
    expect(toc.properties?.text).toEqual({ type: 'string' });
    expect(toc.additionalProperties).toBe(false);
  });
});
