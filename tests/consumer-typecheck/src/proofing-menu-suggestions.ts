import type { Config } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

type ProofingProvider = NonNullable<NonNullable<Config['proofing']>['provider']>;
type Suggest = NonNullable<ProofingProvider['suggest']>;
type SuggestRequest = Parameters<Suggest>[0];
type SuggestResult = Awaited<ReturnType<Suggest>>;
type CheckIssue = Awaited<ReturnType<ProofingProvider['check']>>['issues'][number];

const _text: AssertEqual<SuggestRequest['text'], string> = true;
const _signal: AssertEqual<SuggestRequest['signal'], AbortSignal> = true;
const _maxSuggestions: AssertEqual<SuggestRequest['maxSuggestions'], number | undefined> = true;
const _segment: AssertEqual<SuggestRequest['segment'], Parameters<ProofingProvider['check']>[0]['segments'][number]> =
  true;
const _issue: AssertEqual<SuggestRequest['issue'], Omit<CheckIssue, 'replacements'>> = true;
const _result: AssertEqual<SuggestResult, { replacements: string[] }> = true;

export const lazyProvider: ProofingProvider = {
  id: 'lazy-dictionary',
  check: async ({ segments }) => ({
    issues: segments.map((segment) => ({ segmentId: segment.id, start: 0, end: 1, kind: 'spelling' as const })),
  }),
  suggest: async ({ text, maxSuggestions = 3, segment, issue, signal }) => {
    signal.throwIfAborted();
    const _flagged: string = segment.text.slice(issue.start, issue.end);
    // @ts-expect-error check() owns eager replacements; suggest() receives the issue without them.
    void issue.replacements;
    return { replacements: [text].slice(0, maxSuggestions) };
  },
};

export const eagerProvider: ProofingProvider = {
  id: 'eager-dictionary',
  check: async () => ({ issues: [] }),
};

export const bareArrayProvider: ProofingProvider = {
  id: 'bare-array',
  check: async () => ({ issues: [] }),
  // @ts-expect-error suggest() resolves to { replacements }, not a bare array.
  suggest: async () => ['Statement'],
};
