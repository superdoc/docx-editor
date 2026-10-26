/** Consumer typecheck for named Config callback and public event payloads. */
import type {
  Config,
  DocumentMode,
  FontsChangedPayload,
  FontsChangedSource,
  FontsResolvedPayload,
  SuperDoc,
  SuperDocCommentsListChangePayload,
  SuperDocContentErrorPayload,
  SuperDocDocumentModeChangePayload,
  SuperDocFormattingMarksChangePayload,
  SuperDocPageCountKnownPayload,
  SuperDocPaginationUpdatePayload,
} from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;
type OptionalCallback = ((...args: any) => any) | undefined;
type ParamOf<F extends OptionalCallback> = Parameters<NonNullable<F>>[0];
type ReturnOf<F extends OptionalCallback> = ReturnType<NonNullable<F>>;

type ExpectedContentErrorPayload = {
  error: unknown;
  editor: NonNullable<SuperDoc['activeEditor']>;
  documentId: string;
  file: globalThis.File | globalThis.Blob | null | undefined;
};
type ExpectedCommentsListChangePayload = { isRendered: boolean };
type ExpectedPaginationUpdatePayload = { totalPages: number; superdoc: SuperDoc };
type ExpectedPageCountKnownPayload = { pageCount: number; generation: number };
type ExpectedFormattingMarksChangePayload = { showFormattingMarks: boolean; superdoc: SuperDoc };
type ExpectedDocumentModeChangePayload = { documentMode: DocumentMode };
type ExpectedFontsChangedSource = 'initial' | 'diagnostic-settle' | 'config-change' | 'late-load' | 'render-change';
type ExpectedFontLoadSummary = {
  loaded: number;
  failed: number;
  timedOut: number;
  fallbackUsed: number;
  results: Array<{
    family: string;
    status: 'unloaded' | 'loading' | 'loaded' | 'failed' | 'timed_out' | 'fallback_used';
  }>;
};
type ExpectedFontReportPayload = {
  report?: ReturnType<SuperDoc['fonts']['getReport']>;
  missingFonts?: string[];
  documentFonts?: string[];
  documentFontOptions?: ReturnType<SuperDoc['fonts']['getDocumentFontOptions']>;
  source?: ExpectedFontsChangedSource;
  loadSummary?: ExpectedFontLoadSummary | null;
  [key: string]: unknown;
};

const _onContentErrorParams: AssertEqual<ParamOf<Config['onContentError']>, ExpectedContentErrorPayload> = true;
const _onCommentsListChangeParams: AssertEqual<
  ParamOf<Config['onCommentsListChange']>,
  ExpectedCommentsListChangePayload
> = true;
const _onPaginationUpdateParams: AssertEqual<
  ParamOf<Config['onPaginationUpdate']>,
  ExpectedPaginationUpdatePayload
> = true;
const _onPageCountKnownParams: AssertEqual<ParamOf<Config['onPageCountKnown']>, ExpectedPageCountKnownPayload> = true;
const _onFontsResolvedParams: AssertEqual<ParamOf<Config['onFontsResolved']>, ExpectedFontReportPayload> = true;
const _onFontsChangedParams: AssertEqual<ParamOf<Config['onFontsChanged']>, ExpectedFontReportPayload> = true;
const _namedContentError: AssertEqual<SuperDocContentErrorPayload, ExpectedContentErrorPayload> = true;
const _namedCommentsList: AssertEqual<SuperDocCommentsListChangePayload, ExpectedCommentsListChangePayload> = true;
const _namedPagination: AssertEqual<SuperDocPaginationUpdatePayload, ExpectedPaginationUpdatePayload> = true;
const _namedPageCount: AssertEqual<SuperDocPageCountKnownPayload, ExpectedPageCountKnownPayload> = true;
const _namedFontsResolved: AssertEqual<FontsResolvedPayload, ExpectedFontReportPayload> = true;
const _namedFontsChanged: AssertEqual<FontsChangedPayload, ExpectedFontReportPayload> = true;
const _namedFontSource: AssertEqual<FontsChangedSource, ExpectedFontsChangedSource> = true;
const _contentErrorReturn: AssertEqual<ReturnOf<Config['onContentError']>, void> = true;
const _commentsListReturn: AssertEqual<ReturnOf<Config['onCommentsListChange']>, void> = true;
const _paginationReturn: AssertEqual<ReturnOf<Config['onPaginationUpdate']>, void> = true;
const _pageCountReturn: AssertEqual<ReturnOf<Config['onPageCountKnown']>, void> = true;
const _fontsResolvedReturn: AssertEqual<ReturnOf<Config['onFontsResolved']>, void> = true;
const _fontsChangedReturn: AssertEqual<ReturnOf<Config['onFontsChanged']>, void> = true;
const _fontSource: FontsChangedSource = 'diagnostic-settle';
// @ts-expect-error Font report reasons are a closed public union.
const _invalidFontSource: FontsChangedSource = 'unknown';

declare const superdoc: SuperDoc;

superdoc.on('formatting-marks-change', (payload) => {
  const exact: AssertEqual<typeof payload, ExpectedFormattingMarksChangePayload> = true;
  const named: AssertEqual<SuperDocFormattingMarksChangePayload, ExpectedFormattingMarksChangePayload> = true;
  void [exact, named];
});

superdoc.on('document-mode-change', (payload) => {
  const exact: AssertEqual<typeof payload, ExpectedDocumentModeChangePayload> = true;
  const named: AssertEqual<SuperDocDocumentModeChangePayload, ExpectedDocumentModeChangePayload> = true;
  void [exact, named];
});

superdoc.on('comments-list-change', (payload) => {
  const exact: AssertEqual<typeof payload, ExpectedCommentsListChangePayload> = true;
  void exact;
});

superdoc.on('pagination-update', (payload) => {
  const exact: AssertEqual<typeof payload, ExpectedPaginationUpdatePayload> = true;
  void exact;
});

superdoc.on('fonts-resolved', (payload) => {
  const exact: AssertEqual<typeof payload, ExpectedFontReportPayload> = true;
  void exact;
});

superdoc.on('fonts-changed', (payload) => {
  const exact: AssertEqual<typeof payload, ExpectedFontReportPayload> = true;
  void exact;
});

void [
  _onContentErrorParams,
  _onCommentsListChangeParams,
  _onPaginationUpdateParams,
  _onPageCountKnownParams,
  _onFontsResolvedParams,
  _onFontsChangedParams,
  _namedContentError,
  _namedCommentsList,
  _namedPagination,
  _namedPageCount,
  _namedFontsResolved,
  _namedFontsChanged,
  _namedFontSource,
  _contentErrorReturn,
  _commentsListReturn,
  _paginationReturn,
  _pageCountReturn,
  _fontsResolvedReturn,
  _fontsChangedReturn,
  _fontSource,
  _invalidFontSource,
];
