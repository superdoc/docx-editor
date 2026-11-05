import type { Comment, CreateRule } from '@oxlint/plugins';

export const PROTECTED_RULES: readonly string[] = ['superdoc/no-comments', 'superdoc/disable-directive-reason'];
export const JUSTIFIED_FORM = '// oxlint-disable-next-line <rule> -- <reason>';

const DIRECTIVE = /^(?:\/\/\/?|\/\*+)\s*(?:eslint|oxlint)-(?:disable|enable)\b/;
const RULE_NAME = String.raw`[\w@./]+(?:-[\w@./]+)*`;
const RULE_LIST = String.raw`${RULE_NAME}(?:,\s*${RULE_NAME})*`;
const NEXT_LINE = String.raw`(?:eslint|oxlint)-disable-next-line ${RULE_LIST} -- `;
const JUSTIFIED_LINE = new RegExp(String.raw`^\/\/ ${NEXT_LINE}\S.*$`);
const JUSTIFIED_BLOCK = new RegExp(String.raw`^\/\* ${NEXT_LINE}[^\r\n  ]*\S \*\/$`);

const REASON_SEPARATOR = ' -- ';
const RULE_SEPARATOR = /[\s,]+|\*\/$/;

function disabledRuleNames(text: string): readonly string[] {
  const separator = text.indexOf(REASON_SEPARATOR);
  return (separator === -1 ? text : text.slice(0, separator)).split(RULE_SEPARATOR);
}

export function directiveProblem(text: string): string | null {
  if (!DIRECTIVE.test(text)) return null;
  const names = disabledRuleNames(text);
  const protectedRule = PROTECTED_RULES.find((rule) => names.includes(rule));
  if (protectedRule !== undefined) return `Do not disable ${protectedRule}. Change the code instead.`;
  if (JUSTIFIED_LINE.test(text) || JUSTIFIED_BLOCK.test(text)) return null;
  return `Disable named rules for the next line only, with a reason: \`${JUSTIFIED_FORM}\`.`;
}

function lineStartOf(comment: Comment): Comment['loc'] {
  const { line } = comment.loc.start;
  return { start: { line, column: 0 }, end: { line, column: 0 } };
}

export const disableDirectiveReason = {
  meta: { type: 'problem' },
  create(context) {
    return {
      Program() {
        const { sourceCode } = context;
        for (const comment of sourceCode.getAllComments()) {
          const problem = directiveProblem(sourceCode.text.slice(comment.start, comment.end));
          if (problem !== null) context.report({ loc: lineStartOf(comment), message: problem });
        }
      },
    };
  },
} satisfies CreateRule;
