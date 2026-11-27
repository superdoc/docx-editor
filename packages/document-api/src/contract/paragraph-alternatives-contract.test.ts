import { describe, expect, it } from 'bun:test';
import { validateReplaceInput, executeReplace } from '../replace/replace.js';
import { executeSelectionExtractOoxml } from '../selection/selection.js';
import { DocumentApiValidationError } from '../errors.js';
import { buildInternalContractSchemas } from './schemas.js';
import { validateParagraphsApplyBatchInput } from '../paragraphs/paragraphs.js';
const target = { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' } as const;
const at = {
  kind: 'selection',
  start: { kind: 'nodeEdge', node: target, edge: 'before' },
  end: { kind: 'nodeEdge', node: target, edge: 'after' },
} as const;
describe('paragraph alternatives contract', () => {
  it('requires a local restore precondition and rejects arbitrary XML mutation input', () => {
    for (const call of [
      () => validateReplaceInput({ target, snapshotId: 'original' }, { replaceMode: 'contents' }),
      () => validateReplaceInput({ target, xml: '<w:p/>' }, { replaceMode: 'contents' }),
      () =>
        validateReplaceInput({ target: { ...target, nodeType: 'table' }, text: 'unsafe' }, { replaceMode: 'contents' }),
    ])
      expect(call).toThrow(DocumentApiValidationError);
    expect(() =>
      validateReplaceInput({ target, type: 'ooxml', value: '<w:p/>', namespaces: { w: 'urn:w' } }),
    ).not.toThrow();
  });
  it('fails closed when a runtime does not provide the scoped owner', () => {
    expect(() =>
      executeSelectionExtractOoxml(
        {
          extractOoxml: () => {
            throw new Error('not called');
          },
        } as never,
        { at, retain: true },
      ),
    ).toThrow(DocumentApiValidationError);
    expect(() =>
      executeReplace({} as never, {} as never, { target, text: 'Alternate' }, { replaceMode: 'contents' }),
    ).toThrow(DocumentApiValidationError);
  });
  it('publishes no paragraph capture, replace, restore or release operations', () => {
    const operations = buildInternalContractSchemas().operations;
    expect(Object.keys(operations).some((id) => /^blocks.(capture|replace|restore|release)Paragraph$/.test(id))).toBe(
      false,
    );
  });
});

it('keeps every paragraph batch action closed, target-free and limited to leaf operations', () => {
  const actions =
    buildInternalContractSchemas().operations['format.paragraph.applyBatch'].input.properties.operations.items.oneOf;
  for (const action of actions) {
    expect(action.additionalProperties).toBe(false);
    expect(action.required).toEqual(['operationId', 'input']);
    expect(action.properties.input.additionalProperties).toBe(false);
    expect(action.properties.input.properties).not.toHaveProperty('target');
    expect(action.properties.input.required).not.toContain('target');
    expect(action.properties.operationId.const).not.toMatch(/(?:applyBatch|plan|resetDirectFormatting|setNumbering)$/);
  }
});

it.each([
  ['format.paragraph.setKeepOptions', 'anyOf', ['keepNext', 'keepLines', 'widowControl'], [false, null]],
  ['format.paragraph.setFlowOptions', 'anyOf', ['contextualSpacing', 'pageBreakBefore'], [false, null]],
  ['format.paragraph.setShading', 'oneOf', ['fill', 'color', 'pattern'], ['FFFF00']],
] as const)(
  'SD-6351 projects %s payload alternatives without requiring action targets',
  (operationId, combinator, fields, values) => {
    const operations = buildInternalContractSchemas().operations;
    const leaf = operations[operationId].input;
    const actions = operations['format.paragraph.applyBatch'].input.properties.operations.items.oneOf;
    const input = actions.find((action) => action.properties.operationId.const === operationId).properties.input;
    const allFields =
      operationId === 'format.paragraph.setFlowOptions'
        ? [...fields, 'suppressAutoHyphens', 'autoSpaceDE', 'autoSpaceDN', 'adjustRightInd', 'snapToGrid']
        : fields;

    for (const field of allFields) {
      expect(input.properties[field]).toEqual(leaf.properties[field]);
      for (const value of fields.some((candidate) => candidate === field) ? values : [false]) {
        const action = { operationId, input: { [field]: value } };
        expect(() => validateParagraphsApplyBatchInput({ targets: [target], operations: [action] })).not.toThrow();
        for (const extra of [{ target }, { unknown: true }, { options: {} }]) {
          expect(() =>
            validateParagraphsApplyBatchInput({
              targets: [target],
              operations: [{ ...action, input: { ...action.input, ...extra } }],
            }),
          ).toThrow(DocumentApiValidationError);
        }
      }
    }
    expect(() =>
      validateParagraphsApplyBatchInput({
        targets: [target],
        operations: [{ operationId, input: {} }],
      }),
    ).toThrow(DocumentApiValidationError);
    expect(input.additionalProperties).toBe(false);
    expect(input.properties).not.toHaveProperty('target');
    expect(input.required).not.toContain('target');
    expect(leaf.required).toContain('target');
    expect(leaf[combinator]).toEqual(allFields.map((field) => ({ required: ['target', field] })));
    expect(input.anyOf).toEqual(allFields.map((field) => ({ required: [field] })));
    expect(input.oneOf).toBeUndefined();
    if (operationId === 'format.paragraph.setShading') {
      for (const shading of [
        { fill: 'FFFF00', pattern: 'solid' },
        { fill: 'FFFF00', color: '000000' },
        { fill: 'FFFF00', color: '000000', pattern: 'solid' },
      ])
        expect(() =>
          validateParagraphsApplyBatchInput({
            targets: [target],
            operations: [{ operationId, input: shading }],
          }),
        ).not.toThrow();
    }
  },
);
