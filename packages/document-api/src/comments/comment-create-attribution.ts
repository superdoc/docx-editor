import { DocumentApiValidationError } from '../errors.js';
import type { CommentCreateAttributionInput, CommentMetadata, CommentMetadataValue } from './comments.types.js';

const MAX_COMMENT_EXTERNAL_ID_LENGTH = 1_024;
const MAX_COMMENT_METADATA_BYTES = 64 * 1_024;
const MAX_COMMENT_METADATA_DEPTH = 32;
const UTF8_ENCODER = new TextEncoder();

export function normalizeCommentCreateAttribution(
  input: CommentCreateAttributionInput,
): CommentCreateAttributionInput | null {
  if (
    input.externalId === undefined &&
    input.author === undefined &&
    input.authorId === undefined &&
    input.authorEmail === undefined &&
    input.authorImage === undefined &&
    input.authorIdentity === undefined &&
    input.metadata === undefined
  ) {
    return null;
  }

  validateOptionalNonEmptyString(input.externalId, 'externalId');
  if (input.externalId !== undefined && exceedsCodePointLength(input.externalId, MAX_COMMENT_EXTERNAL_ID_LENGTH)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `externalId must be at most ${MAX_COMMENT_EXTERNAL_ID_LENGTH} characters.`,
      { field: 'externalId' },
    );
  }
  validateOptionalNonEmptyString(input.author, 'author');
  validateOptionalNonEmptyString(input.authorId, 'authorId');
  validateOptionalNonEmptyString(input.authorEmail, 'authorEmail');
  validateOptionalNonEmptyString(input.authorImage, 'authorImage');

  return {
    ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
    ...(input.author !== undefined ? { author: input.author } : {}),
    ...(input.authorId !== undefined ? { authorId: input.authorId } : {}),
    ...(input.authorEmail !== undefined ? { authorEmail: input.authorEmail } : {}),
    ...(input.authorImage !== undefined ? { authorImage: input.authorImage } : {}),
    ...(input.authorIdentity !== undefined ? { authorIdentity: normalizeAuthorIdentity(input.authorIdentity) } : {}),
    ...(input.metadata !== undefined ? { metadata: normalizeCommentMetadata(input.metadata) } : {}),
  };
}

function exceedsCodePointLength(value: string, maximum: number): boolean {
  let length = 0;
  for (const _character of value) {
    length += 1;
    if (length > maximum) return true;
  }
  return false;
}

function validateOptionalNonEmptyString(value: unknown, field: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${field} must be a non-empty string when provided.`, {
      field,
      value,
    });
  }
}

function normalizeCommentMetadata(value: unknown): CommentMetadata {
  if (!isPlainObject(value)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'metadata must be a JSON object.', {
      field: 'metadata',
      value,
    });
  }
  validateCommentMetadataValue(value, 'metadata', new WeakSet<object>(), 0);
  const json = JSON.stringify(value);
  if (UTF8_ENCODER.encode(json).length > MAX_COMMENT_METADATA_BYTES) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `metadata must be at most ${MAX_COMMENT_METADATA_BYTES} UTF-8 bytes when serialized.`,
      { field: 'metadata' },
    );
  }
  return JSON.parse(json) as CommentMetadata;
}

function validateCommentMetadataValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
  depth: number,
): asserts value is CommentMetadataValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw invalidCommentMetadata(path, 'numbers must be finite');
  }
  if (depth >= MAX_COMMENT_METADATA_DEPTH) {
    throw invalidCommentMetadata(path, `nesting must not exceed ${MAX_COMMENT_METADATA_DEPTH} levels`);
  }
  if (Array.isArray(value)) {
    validateCommentMetadataContainer(value, path, ancestors, depth, (item, index) => [`${path}[${index}]`, item]);
    return;
  }
  if (isPlainObject(value)) {
    validateCommentMetadataContainer(
      value,
      path,
      ancestors,
      depth,
      ([key, item]) => [`${path}.${key}`, item],
      Object.entries(value),
    );
    return;
  }
  throw invalidCommentMetadata(path, 'values must be JSON-compatible');
}

function validateCommentMetadataContainer<T>(
  container: object,
  path: string,
  ancestors: WeakSet<object>,
  depth: number,
  project: (item: T, index: number) => readonly [string, unknown],
  values: Iterable<T> = container as Iterable<T>,
): void {
  if (ancestors.has(container)) throw invalidCommentMetadata(path, 'cyclic values are not supported');
  ancestors.add(container);
  try {
    let index = 0;
    for (const item of values) {
      const [childPath, child] = project(item, index);
      validateCommentMetadataValue(child, childPath, ancestors, depth + 1);
      index += 1;
    }
  } finally {
    ancestors.delete(container);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  // A realm's Object.prototype always terminates the prototype chain. This
  // admits plain objects passed from an iframe without admitting class values.
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function invalidCommentMetadata(path: string, requirement: string): DocumentApiValidationError {
  return new DocumentApiValidationError('INVALID_INPUT', `${path} is invalid: ${requirement}.`, {
    field: path,
  });
}

function normalizeAuthorIdentity(value: unknown): { providerId: string; userId: string } | null {
  try {
    if (value !== null && !isPlainObject(value)) throw new TypeError('Invalid comment provider identity.');
    return normalizeCommentIdentity(value);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'authorIdentity requires XML-safe non-empty providerId and userId strings.',
      { field: 'authorIdentity' },
    );
  }
}

export function normalizeCommentIdentity(value: unknown): { providerId: string; userId: string } | null {
  if (value === null) return null;
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('providerId' in value) ||
    !('userId' in value) ||
    !xmlIdentityString(value.providerId) ||
    !xmlIdentityString(value.userId)
  ) {
    throw new TypeError('commentIdentity requires XML-safe non-empty providerId and userId strings.');
  }
  return { providerId: value.providerId, userId: value.userId };
}

function xmlIdentityString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value)
  );
}
