const COMMENT_DRAFT_BR_TAG = /<br(?:\s[^>]*)?\s*\/?>/gi;
const COMMENT_DRAFT_BLOCK_BOUNDARY =
  /(?:<\/(?:p|div|li|blockquote|pre|h[1-6])\s*>\s*)+(?:<(?:p|div|li|blockquote|pre|h[1-6])(?:\s[^>]*)?\s*\/?>)+/gi;
const COMMENT_DRAFT_BLOCK_OPEN_TAG = /<(?:p|div|li|blockquote|pre|h[1-6])(?:\s[^>]*)?\s*\/?>/gi;
const COMMENT_DRAFT_BLOCK_CLOSE_TAG = /<\/(?:p|div|li|blockquote|pre|h[1-6])\s*>/gi;
const COMMENT_DRAFT_ANY_TAG = /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^>]*)?\s*\/?>/g;
const COMMENT_DRAFT_ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g;
const COMMENT_DRAFT_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const decodeCommentDraftEntity = (entity: string): string | null => {
  const lower = entity.toLowerCase();
  const named = COMMENT_DRAFT_NAMED_ENTITIES[lower];
  if (named !== undefined) return named;
  const radix = lower.startsWith('#x') ? 16 : lower.startsWith('#') ? 10 : null;
  if (!radix) return null;
  const value = lower.startsWith('#x') ? lower.slice(2) : lower.slice(1);
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isFinite(codePoint)) return null;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return null;
  }
};

const decodeCommentDraftEntities = (value: string): string =>
  value.replace(COMMENT_DRAFT_ENTITY, (match, entity: string) => decodeCommentDraftEntity(entity) ?? match);

export const normalizeV2CommentDraftText = (value: unknown): string => {
  const html = String(value ?? '');
  if (!html || html === '<p></p>') return '';
  return decodeCommentDraftEntities(
    html
      .replace(COMMENT_DRAFT_BLOCK_BOUNDARY, '\n')
      .replace(COMMENT_DRAFT_BR_TAG, '\n')
      .replace(COMMENT_DRAFT_BLOCK_CLOSE_TAG, '')
      .replace(COMMENT_DRAFT_BLOCK_OPEN_TAG, '')
      .replace(COMMENT_DRAFT_ANY_TAG, ''),
  );
};
