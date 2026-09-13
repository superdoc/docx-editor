import type { BrowserDocumentApi, DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const compactHtml: string = doc.getHtml({});
const compactMarkdown: string = doc.getMarkdown({});
const invokedCompactHtml: string = doc.invoke({ operationId: 'getHtml', input: {} });
const invokedCompactMarkdown: string = doc.invoke({ operationId: 'getMarkdown', input: {} });
void [compactHtml, compactMarkdown, invokedCompactHtml, invokedCompactMarkdown];

const selection = {
  kind: 'selection' as const,
  start: { kind: 'text' as const, blockId: 'paragraph-1', offset: 0 },
  end: { kind: 'text' as const, blockId: 'paragraph-1', offset: 4 },
};
const paragraph = {
  kind: 'block' as const,
  nodeType: 'paragraph' as const,
  nodeId: 'paragraph-1',
};
const fragment = {
  kind: 'paragraph' as const,
  paragraph: {
    inlines: [{ kind: 'run' as const, run: { text: 'Canonical content' } }],
  },
};

// Parameter and return proofs for the synchronous public Document API.
const htmlInput: Parameters<DocumentApi['htmlToFragment']>[0] = { html: '<p>Canonical content</p>' };
const markdownInput: Parameters<DocumentApi['markdownToFragment']>[0] = { markdown: 'Canonical content' };
const htmlResult: ReturnType<DocumentApi['htmlToFragment']> = doc.htmlToFragment(htmlInput);
const markdownResult: ReturnType<DocumentApi['markdownToFragment']> = doc.markdownToFragment(markdownInput);

const mutationInput: Parameters<DocumentApi['mutations']['apply']>[0] = {
  atomic: true,
  changeMode: 'direct',
  steps: [
    {
      id: 'rewrite-selection',
      op: 'text.rewrite',
      where: { by: 'target', target: selection },
      args: { replacement: { text: 'Updated content' } },
    },
  ],
};
const mutationResult: ReturnType<DocumentApi['mutations']['apply']> = doc.mutations.apply(mutationInput);
const inspectMutationResult = async () => {
  const invalidatedRefs = (await mutationResult).invalidatedRefs;
  void invalidatedRefs;
};
void inspectMutationResult;

for (const diagnostic of htmlResult.diagnostics) {
  const format: 'html' | 'markdown' = diagnostic.source.format;
  const disposition: 'preserved' | 'normalized' | 'downgraded' | 'dropped' | 'rejected' = diagnostic.disposition;
  const construct: string = diagnostic.construct;
  void [format, disposition, construct, diagnostic.source.range, diagnostic.path];
}
for (const diagnostic of markdownResult.diagnostics) {
  const baseCode: string = diagnostic.code;
  const baseSeverity: 'info' | 'warning' | 'error' = diagnostic.severity;
  void [baseCode, baseSeverity, diagnostic.message];
}

const richInsert = doc.insert(
  { type: 'html', value: '<p>Tracked insertion</p>', target: paragraph, placement: 'after' },
  { changeMode: 'tracked' },
);
const markdownInsert = doc.insert(
  { type: 'markdown', value: '**At the caret**', target: selection },
  { changeMode: 'direct' },
);
const fragmentInsert = doc.insert({ content: fragment, target: paragraph, placement: 'before' });
const appendInsert = doc.insert({ type: 'html', value: '<p>Append</p>' });

const richReplace = doc.replace(
  { type: 'markdown', value: '**Replacement**', target: selection, nestingPolicy: { tables: 'forbid' } },
  { changeMode: 'tracked' },
);
const fragmentReplace = doc.replace({ content: fragment, target: paragraph });
const refReplace = doc.replace({ type: 'html', value: '<p>Ref replacement</p>', ref: 'v2-text:opaque' });

const invokedHtml: ReturnType<DocumentApi['invoke']> = doc.invoke({
  operationId: 'htmlToFragment',
  input: htmlInput,
});
const invokedTrackedInsert: ReturnType<DocumentApi['invoke']> = doc.invoke({
  operationId: 'insert',
  input: { type: 'markdown', value: 'Invoked' },
  options: { changeMode: 'tracked' },
});

// A parsed rich clipboard fragment is a reusable transport value, including
// every block and inline shape emitted by the shared HTML converter.
const parsedClipboard = doc.clipboard.parse({
  source: 'api',
  items: [
    { type: 'text/html', kind: 'string', data: '<h2>Title</h2><p><a href="https://example.com">Link</a><br></p><hr>' },
  ],
});
if (parsedClipboard.success) {
  doc.clipboard.insert({ fragment: parsedClipboard.plan.fragment });
  for (const block of parsedClipboard.plan.fragment.blocks) {
    if (block.kind === 'heading') {
      const level: 1 | 2 | 3 | 4 | 5 | 6 = block.level;
      void level;
    } else if (block.kind === 'horizontalRule') {
      void block.sourcePath;
    } else if (block.kind === 'paragraph') {
      for (const run of block.runs) {
        const commentIds: readonly string[] | undefined = run.commentIds;
        const trackedInsertion: boolean | undefined = run.trackedInsertion;
        void [commentIds, trackedInsertion];
      }
      for (const inline of block.inlines ?? []) {
        if (inline.kind === 'hyperlink') void inline.target;
        if (inline.kind === 'lineBreak') void inline.sourcePath;
        if (inline.kind === 'text') {
          const commentIds: readonly string[] | undefined = inline.commentIds;
          const trackedInsertion: boolean | undefined = inline.trackedInsertion;
          void [commentIds, trackedInsertion];
        }
      }
    }
  }
  const comments: typeof parsedClipboard.plan.fragment.comments = parsedClipboard.plan.fragment.comments;
  void comments;
}

for (const receipt of [
  richInsert,
  markdownInsert,
  fragmentInsert,
  appendInsert,
  richReplace,
  fragmentReplace,
  refReplace,
]) {
  if (!receipt.success) {
    const failureCode: string | undefined = receipt.failure?.code;
    void [failureCode, receipt.conversion?.diagnostics];
    continue;
  }
  const txId: string | undefined = receipt.txId;
  const entityId: string | undefined = receipt.inserted?.[0]?.entityId;
  const sourcePath: ReadonlyArray<string | number> | undefined =
    receipt.effects?.insertedBlocks?.[0]?.sourcePath ?? receipt.effects?.insertedText?.[0]?.sourcePath;
  const conversionFormat: 'html' | 'markdown' | undefined = receipt.conversion?.format;
  void [txId, entityId, sourcePath, conversionFormat, receipt.affectedStories, receipt.textRangeShifts];
}

// BrowserDocumentApi recursively maps the same calls and result shapes to MaybePromise leaves.
const browserHtml: ReturnType<BrowserDocumentApi['htmlToFragment']> = browserDoc.htmlToFragment(htmlInput);
const browserMarkdown: ReturnType<BrowserDocumentApi['markdownToFragment']> =
  browserDoc.markdownToFragment(markdownInput);
const browserInsert: ReturnType<BrowserDocumentApi['insert']> = browserDoc.insert(
  { type: 'html', value: '<p>Browser</p>' },
  { changeMode: 'tracked' },
);
const browserReplace: ReturnType<BrowserDocumentApi['replace']> = browserDoc.replace(
  { type: 'markdown', value: 'Browser replacement', target: selection },
  { dryRun: true },
);
const browserInvoke: ReturnType<BrowserDocumentApi['invoke']> = browserDoc.invoke({
  operationId: 'htmlToFragment',
  input: htmlInput,
});
const browserHtmlPromise: Promise<Awaited<ReturnType<DocumentApi['htmlToFragment']>>> = Promise.resolve(browserHtml);
const browserInsertPromise: Promise<Awaited<ReturnType<DocumentApi['insert']>>> = Promise.resolve(browserInsert);

// Existing plain-text and named Markdown calls remain source-compatible.
const oldInsert = doc.insert({ value: 'Plain text' });
const oldReplace = doc.replace({ target: selection, text: 'Plain replacement' });
const oldMarkdown = doc.markdownToFragment({ markdown: '# Existing call' });

void [
  invokedHtml,
  invokedTrackedInsert,
  browserHtml,
  browserMarkdown,
  browserInsert,
  browserReplace,
  browserInvoke,
  browserHtmlPromise,
  browserInsertPromise,
  oldInsert,
  oldReplace,
  oldMarkdown,
  parsedClipboard,
];
