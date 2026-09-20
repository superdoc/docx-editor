import type {
  BrowserDocumentApi,
  DocumentApi,
  OperationCapabilityResolveResult,
  RichContentInsertInput,
  SDHtmlMarkdownSupportCheckResult,
} from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

const richInsert: RichContentInsertInput = {
  type: 'markdown',
  value: '# Checked content',
  target: { kind: 'block', nodeType: 'paragraph', nodeId: 'paragraph-1' },
  placement: 'after',
};

async function checkThenApply(): Promise<void> {
  const check: SDHtmlMarkdownSupportCheckResult = await doc.capabilities.check({
    operation: 'insert',
    input: richInsert,
    options: { changeMode: 'tracked' },
  });

  if (check.operation === 'insert' && check.supported && check.guard) {
    const receipt = doc.insert(richInsert, { changeMode: 'tracked', supportCheck: check.guard });
    const outcome = receipt.outcome;
    void outcome;
  }

  const projected = await doc.capabilities.check({
    operation: 'projectHtml',
    input: { reviewMode: 'redline', includeSourceMap: true },
  });
  if (projected.operation === 'projectHtml' && projected.projection) {
    const sameOutcome = projected.outcome === projected.projection.outcome;
    void sameOutcome;
  }
}

const browserCheck: ReturnType<BrowserDocumentApi['capabilities']['check']> = browserDoc.capabilities.check({
  operation: 'projectMarkdown',
  input: { reviewMode: 'final' },
});

const trackedResolution: OperationCapabilityResolveResult = doc.capabilities.resolve({
  operationId: 'images.move',
  input: {
    target: { kind: 'image', nodeId: 'image-1' },
    destination: { kind: 'placement', at: 'document_end' },
  },
  options: { changeMode: 'tracked' },
});
if (trackedResolution.tracked.kind === 'requires-input') {
  const reasonCode: 'TARGET_CONTEXT_REQUIRED' = trackedResolution.tracked.code;
  void reasonCode;
}

void [checkThenApply, browserCheck, trackedResolution];
