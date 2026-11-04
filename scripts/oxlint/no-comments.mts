import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Comment, CreateRule, ESTree, SourceCode } from '@oxlint/plugins';

export const DIRECTIVE =
  /^(?:\/\/\/?|\/\*+)\s*(?:@ts-(?:expect-error|ignore|check|nocheck)\b|[@#]__PURE__|[@#]__NO_SIDE_EFFECTS__|@vitest-environment\b|@vite-ignore\b|@jsxImportSource\b|webpack[A-Z]\w*:|(?:eslint|oxlint)-(?:disable|enable)\b|prettier-ignore\b|<reference\s)/;
export const TICKET_REFERENCE = /^\/\/ SD-\d+: \S.*$/;
export const JSDOC = /^\/\*\*(?!\/)[\s\S]*\*\/$/;
export const PUBLIC_TYPE_SURFACES: ReadonlySet<string> = new Set([
  'packages/superdoc/src/core/types/index.ts',
  'packages/superdoc/src/public/ui/types.ts',
  'packages/react/src/types.ts',
]);

const PUBLIC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RULE_NAME = 'superdoc/no-comments';
const LINE_BREAK = /[\n\r]/;

export interface CommentFacts {
  text: string;
  standalone: boolean;
  documentsDeclaration: boolean;
  inPublicTypeSurface: boolean;
}

export function isAllowedComment({
  text,
  standalone,
  documentsDeclaration,
  inPublicTypeSurface,
}: CommentFacts): boolean {
  if (DIRECTIVE.test(text)) return !text.includes(RULE_NAME);
  if (standalone && TICKET_REFERENCE.test(text)) return true;
  return inPublicTypeSurface && documentsDeclaration && JSDOC.test(text);
}

export function isPublicTypeSurface(filename: string): boolean {
  return PUBLIC_TYPE_SURFACES.has(path.relative(PUBLIC_ROOT, filename).replaceAll('\\', '/'));
}

type DocumentedDeclaration =
  | ESTree.TSInterfaceDeclaration
  | ESTree.TSTypeAliasDeclaration
  | ESTree.TSPropertySignature
  | ESTree.TSMethodSignature
  | ESTree.TSIndexSignature;

function isExportOf(
  parent: ESTree.Node | null,
  node: DocumentedDeclaration,
): parent is ESTree.ExportNamedDeclaration | ESTree.ExportDefaultDeclaration {
  return (
    (parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration') &&
    parent.declaration === node
  );
}

function hasLineBreakOutside(text: string, from: number, to: number, comments: readonly Comment[]): boolean {
  let cursor = from;
  for (const comment of comments) {
    if (LINE_BREAK.test(text.slice(cursor, comment.start))) return true;
    cursor = comment.end;
  }
  return LINE_BREAK.test(text.slice(cursor, to));
}

function leadingDocComment(sourceCode: SourceCode, node: DocumentedDeclaration): Comment | undefined {
  const target = isExportOf(node.parent, node) ? node.parent : node;
  const comments = sourceCode.getCommentsBefore(target);
  const last = comments.at(-1);
  if (last === undefined) return undefined;
  const previous = sourceCode.getTokenBefore(target);
  if (previous === null) return last;
  return hasLineBreakOutside(sourceCode.text, previous.end, last.start, comments.slice(0, -1)) ? last : undefined;
}

function isStandalone(comments: readonly Comment[], index: number): boolean {
  const comment = comments[index];
  if (comment === undefined) return false;
  const before = comments[index - 1];
  const after = comments[index + 1];
  return (
    (before === undefined || before.loc.end.line < comment.loc.start.line - 1) &&
    (after === undefined || after.loc.start.line > comment.loc.end.line + 1)
  );
}

export const noComments = {
  meta: { type: 'suggestion' },
  create(context) {
    const { sourceCode } = context;
    const inPublicTypeSurface = isPublicTypeSurface(context.filename);
    const documenting = new Set<number>();
    const noteDocComment = (node: DocumentedDeclaration): void => {
      const comment = leadingDocComment(sourceCode, node);
      if (comment !== undefined) documenting.add(comment.start);
    };
    return {
      TSInterfaceDeclaration: noteDocComment,
      TSTypeAliasDeclaration: noteDocComment,
      TSPropertySignature: noteDocComment,
      TSMethodSignature: noteDocComment,
      TSIndexSignature: noteDocComment,
      'Program:exit'() {
        const comments = sourceCode.getAllComments().filter((comment) => comment.type !== 'Shebang');
        comments.forEach((comment, index) => {
          const facts: CommentFacts = {
            text: sourceCode.text.slice(comment.start, comment.end),
            standalone: isStandalone(comments, index),
            documentsDeclaration: documenting.has(comment.start),
            inPublicTypeSurface,
          };
          if (!isAllowedComment(facts)) {
            context.report({
              loc: comment.loc,
              message: 'Remove this comment. Express the rule in names, types, a lint rule, or a test.',
            });
          }
        });
      },
    };
  },
} satisfies CreateRule;
