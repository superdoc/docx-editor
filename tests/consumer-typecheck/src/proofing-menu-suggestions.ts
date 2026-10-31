import type {
  Config,
  ProofingCapabilities,
  ProofingCheckRequest,
  ProofingCheckResult,
  ProofingConfig,
  ProofingError,
  ProofingIssue,
  ProofingIssueKind,
  ProofingProvider,
  ProofingSegment,
  ProofingSegmentMetadata,
  ProofingStatus,
  ProofingSuggestRequest,
  ProofingSuggestResult,
} from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

type ConfigProofing = NonNullable<Config['proofing']>;
type ConfigProvider = NonNullable<ConfigProofing['provider']>;
type Check = ConfigProvider['check'];
type CheckRequest = Parameters<Check>[0];
type CheckResult = Awaited<ReturnType<Check>>;
type GetCapabilities = NonNullable<ConfigProvider['getCapabilities']>;
type Suggest = NonNullable<ConfigProvider['suggest']>;
type SuggestRequest = Parameters<Suggest>[0];
type SuggestResult = Awaited<ReturnType<Suggest>>;
type CheckIssue = CheckResult['issues'][number];
type OnStatusChange = NonNullable<ConfigProofing['onStatusChange']>;
type OnProofingError = NonNullable<ConfigProofing['onProofingError']>;

const _namedConfig: AssertEqual<ProofingConfig, ConfigProofing> = true;
const _namedProvider: AssertEqual<ProofingProvider, ConfigProvider> = true;
const _namedCapabilities: AssertEqual<ProofingCapabilities, Awaited<ReturnType<GetCapabilities>>> = true;
const _namedCheckRequest: AssertEqual<ProofingCheckRequest, CheckRequest> = true;
const _namedCheckResult: AssertEqual<ProofingCheckResult, CheckResult> = true;
const _namedSegment: AssertEqual<ProofingSegment, CheckRequest['segments'][number]> = true;
const _namedSegmentMetadata: AssertEqual<ProofingSegmentMetadata, CheckRequest['segments'][number]['metadata']> = true;
const _namedIssue: AssertEqual<ProofingIssue, CheckIssue> = true;
const _namedIssueKind: AssertEqual<ProofingIssueKind, CheckIssue['kind']> = true;
const _namedSuggestRequest: AssertEqual<ProofingSuggestRequest, SuggestRequest> = true;
const _namedSuggestResult: AssertEqual<ProofingSuggestResult, SuggestResult> = true;
const _namedStatus: AssertEqual<ProofingStatus, Parameters<OnStatusChange>[0]> = true;
const _statusReturn: AssertEqual<ReturnType<OnStatusChange>, void> = true;
const _namedError: AssertEqual<ProofingError, Parameters<OnProofingError>[0]> = true;
const _errorReturn: AssertEqual<ReturnType<OnProofingError>, void> = true;

const _text: AssertEqual<SuggestRequest['text'], string> = true;
const _signal: AssertEqual<SuggestRequest['signal'], AbortSignal> = true;
const _maxSuggestions: AssertEqual<SuggestRequest['maxSuggestions'], number | undefined> = true;
const _segment: AssertEqual<SuggestRequest['segment'], CheckRequest['segments'][number]> = true;
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

const toIssue = (segment: ProofingSegment, kind: ProofingIssueKind): ProofingIssue => ({
  segmentId: segment.id,
  start: 0,
  end: segment.text.length,
  kind,
});

export const namedTypesProvider: ProofingProvider = {
  id: 'named-types',
  getCapabilities: (): ProofingCapabilities => ({ issueKinds: ['spelling'], supportsSuggestions: true }),
  check: async (request: ProofingCheckRequest): Promise<ProofingCheckResult> => ({
    issues: request.segments
      .filter((segment) => segment.metadata.surface === 'body')
      .map((segment) => toIssue(segment, 'spelling')),
  }),
  suggest: async (request: ProofingSuggestRequest): Promise<ProofingSuggestResult> => ({
    replacements: [request.text.toUpperCase()],
  }),
};

export const namedConfig: ProofingConfig = {
  enabled: true,
  provider: namedTypesProvider,
  onStatusChange: (status: ProofingStatus) => void status,
  onProofingError: (error: ProofingError) => void error.kind,
};

export const config: Config = { selector: '#editor', proofing: namedConfig };
