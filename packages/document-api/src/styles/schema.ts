/**
 * JSON Schema generation from the ValueSchema AST.
 *
 * Imports only from registry.ts. Consumed by contract/schemas.ts.
 */

import type { ValueSchema, StylesChannel, StylesScope } from './registry.js';
import { EXCLUDED_KEYS_BY_SCOPE, PROPERTY_REGISTRY } from './registry.js';

type JsonSchema = Record<string, unknown>;

// ---------------------------------------------------------------------------
// ValueSchema → JSON Schema conversion (recursive)
// ---------------------------------------------------------------------------

/** Converts a ValueSchema AST node to a JSON Schema object. */
export function toJsonSchema(schema: ValueSchema): JsonSchema {
  switch (schema.kind) {
    case 'boolean':
      return { type: 'boolean' };

    case 'integer': {
      const s: JsonSchema = { type: 'integer' };
      if (schema.min !== undefined) s.minimum = schema.min;
      if (schema.max !== undefined) s.maximum = schema.max;
      return s;
    }

    case 'enum':
      return { enum: [...schema.values] };

    case 'string':
      return { type: 'string', minLength: 1 };

    case 'object': {
      const properties: Record<string, JsonSchema> = {};
      for (const [key, childSchema] of Object.entries(schema.children)) {
        properties[key] = toJsonSchema(childSchema);
      }
      return {
        type: 'object',
        properties,
        additionalProperties: false,
        minProperties: 1,
      };
    }

    case 'array':
      return {
        type: 'array',
        items: toJsonSchema(schema.item),
      };
  }
}

// ---------------------------------------------------------------------------
// Registry → patch schemas (for contract/schemas.ts)
// ---------------------------------------------------------------------------

/**
 * Builds a JSON Schema for the patch object of a given channel and scope.
 *
 * The scope filter is what keeps the published `styles.apply` schema honest:
 * the registry now carries run properties that only a named style accepts, and
 * a schema that advertised them on `docDefaults` would describe an input the
 * validator rejects.
 */
export function buildPatchSchema(
  channel: StylesChannel,
  scope: StylesScope = 'docDefaults',
  options: { nullable?: boolean } = {},
): JsonSchema {
  const excluded = EXCLUDED_KEYS_BY_SCOPE[scope][channel];
  const properties: Record<string, JsonSchema> = {};
  for (const def of PROPERTY_REGISTRY) {
    if (def.channel !== channel) continue;
    if (excluded.has(def.key)) continue;
    const schema = toJsonSchema(def.schema);
    properties[def.key] = options.nullable ? { oneOf: [schema, { type: 'null' }] } : schema;
  }
  return {
    type: 'object',
    properties,
    additionalProperties: false,
    minProperties: 1,
  };
}

/**
 * Builds a JSON Schema for the before/after state map of a given scope.
 *
 * Scoped for the same reason `buildPatchSchema` is: a receipt cannot report
 * state for a property the scope does not accept, and advertising one both
 * misleads a contract-driven caller and loosens receipt validation, since these
 * objects carry `additionalProperties: false`.
 *
 * `channel` narrows it further, for a receipt that reports the two channels
 * separately. Omitted, both fold into one map — correct only where something
 * else in the receipt says which channel it describes, as `styles.apply`'s
 * `resolution.channel` does.
 */
export function buildStateSchema(scope: StylesScope = 'docDefaults', channel?: StylesChannel): JsonSchema {
  const excluded = EXCLUDED_KEYS_BY_SCOPE[scope];
  const properties: Record<string, JsonSchema> = {};

  for (const def of PROPERTY_REGISTRY) {
    if (channel !== undefined && def.channel !== channel) continue;
    if (excluded[def.channel].has(def.key)) continue;
    const schema = def.schema;
    switch (schema.kind) {
      case 'boolean':
        properties[def.key] = { enum: ['on', 'off', 'inherit'] };
        break;
      case 'integer':
        properties[def.key] = { oneOf: [{ type: 'number' }, { const: 'inherit' }] };
        break;
      case 'enum':
      case 'string':
        properties[def.key] = { oneOf: [{ type: 'string' }, { const: 'inherit' }] };
        break;
      case 'object':
        properties[def.key] = { oneOf: [{ type: 'object' }, { const: 'inherit' }] };
        break;
      case 'array':
        properties[def.key] = { oneOf: [{ type: 'array' }, { const: 'inherit' }] };
        break;
    }
  }

  return {
    type: 'object',
    properties,
    additionalProperties: false,
  };
}
