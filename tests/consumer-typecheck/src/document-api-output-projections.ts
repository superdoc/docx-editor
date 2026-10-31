import type { BrowserDocumentApi, DocumentApi, TextTarget } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const trackedScope = {
  kind: 'selection' as const,
  coordinateSpace: 'tracked' as const,
  start: { kind: 'text' as const, blockId: 'paragraph-1', offset: 1 },
  end: { kind: 'text' as const, blockId: 'paragraph-2', offset: 4 },
};

type ProjectHtmlInput = Parameters<DocumentApi['projectHtml']>[0];
type ProjectMarkdownInput = Parameters<DocumentApi['projectMarkdown']>[0];
type HtmlProjectionResult = Awaited<ReturnType<DocumentApi['projectHtml']>>;
type MarkdownProjectionResult = Awaited<ReturnType<DocumentApi['projectMarkdown']>>;

const htmlInput: ProjectHtmlInput = {
  reviewMode: 'redline',
  scope: trackedScope,
  includeSourceMap: true,
};
const markdownInput: ProjectMarkdownInput = {
  in: { kind: 'story', storyType: 'footnote', noteId: '2' },
  reviewMode: 'original',
  scope: { kind: 'block', nodeType: 'paragraph', nodeId: 'paragraph-1' },
  includeSourceMap: true,
};

const htmlProjection: Promise<HtmlProjectionResult> = doc.projectHtml(htmlInput);
const markdownProjection: Promise<MarkdownProjectionResult> = doc.projectMarkdown(markdownInput);
const invokedHtmlProjection: Promise<HtmlProjectionResult> = doc.invoke<'projectHtml'>({
  operationId: 'projectHtml',
  input: htmlInput,
});
const invokedMarkdownProjection: Promise<MarkdownProjectionResult> = doc.invoke<'projectMarkdown'>({
  operationId: 'projectMarkdown',
  input: markdownInput,
});

const compactHtml: string = doc.getHtml({ reviewMode: 'redline', scope: trackedScope });
const deprecatedListOptionStillCompiles: string = doc.getHtml({ unflattenLists: false });
const compactMarkdown: string = doc.getMarkdown({ reviewMode: 'original', scope: trackedScope });

const browserHtmlProjection: ReturnType<BrowserDocumentApi['projectHtml']> = browserDoc.projectHtml(htmlInput);
const browserMarkdownProjection: ReturnType<BrowserDocumentApi['projectMarkdown']> =
  browserDoc.projectMarkdown(markdownInput);
const browserCompactHtml: ReturnType<BrowserDocumentApi['getHtml']> = browserDoc.getHtml({});

declare const htmlResult: HtmlProjectionResult;
declare const markdownResult: MarkdownProjectionResult;
const htmlFormat: 'html' = htmlResult.format;
const markdownFormat: 'markdown' = markdownResult.format;
const evaluatedRevision: string = htmlResult.evaluatedRevision;
const outputOffset: number | undefined = htmlResult.blocks[0]?.output.start;
const annotationStatus: 'emitted' | 'partiallyEmitted' | 'omitted' | undefined = htmlResult.annotations[0]?.status;

const textEntry = htmlResult.sourceMap?.entries.find((entry) => entry.kind === 'text');
if (textEntry?.kind === 'text') {
  const sourceTarget: TextTarget & { coordinateSpace: 'tracked' } = textEntry.source;
  const sourceBlockId: string = textEntry.blockId;
  const sourceStart: number = sourceTarget.segments[0].range.start;
  doc.comments.create(
    { text: 'Review the projected source.', target: sourceTarget },
    { expectedRevision: htmlResult.evaluatedRevision },
  );
  void [sourceBlockId, sourceStart];
}

const guardedComment = doc.comments.create({
  text: 'Check this figure.',
  target: {
    kind: 'selection',
    captureState: 'opaque-browser-capture',
    start: { kind: 'text', blockId: 'b1', offset: 7 },
    end: { kind: 'text', blockId: 'b1', offset: 14 },
  },
  expectedText: 'Revenue',
});
const guardedFailureCode: string | undefined = guardedComment.success ? undefined : guardedComment.failure.code;

void [
  htmlProjection,
  markdownProjection,
  invokedHtmlProjection,
  invokedMarkdownProjection,
  compactHtml,
  deprecatedListOptionStillCompiles,
  compactMarkdown,
  browserHtmlProjection,
  browserMarkdownProjection,
  browserCompactHtml,
  htmlFormat,
  markdownFormat,
  evaluatedRevision,
  outputOffset,
  annotationStatus,
  markdownResult,
  guardedFailureCode,
];
