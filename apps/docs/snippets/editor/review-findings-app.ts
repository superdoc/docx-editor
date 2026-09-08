import { SuperDoc } from 'superdoc';
import { createReviewFindings, isSupersededRefresh } from './review-highlights';
import type { BoundReviewSelection, ReviewFinding } from './review-highlights';
import 'superdoc/style.css';

function element<T extends HTMLElement>(id: string): T {
  const node = document.querySelector<T>(`#${id}`);
  if (!node) throw new Error(`Missing review element: ${id}`);
  return node;
}

const ask = element<HTMLButtonElement>('ask');
const prompt = element<HTMLFormElement>('prompt');
const quote = element<HTMLQuoteElement>('quote');
const question = element<HTMLInputElement>('question');
const suggested = element<HTMLTextAreaElement>('suggested');
const cancel = element<HTMLButtonElement>('cancel');
const list = element<HTMLUListElement>('findings');
const download = element<HTMLButtonElement>('download');
const status = element<HTMLParagraphElement>('status');
let selection: BoundReviewSelection | null = null;
let rows: readonly ReviewFinding[] = [];
let pending = false;
let ready = false;
let stopSelection: (() => void) | undefined;

const review = createReviewFindings({
  onFindingsChanged: renderFindings,
  onFindingsError: (error) => {
    if (isSupersededRefresh(error)) return;
    renderFindings([]);
    showError(error);
  },
});

function showError(error: unknown) {
  if (isSupersededRefresh(error)) return;
  status.textContent = error instanceof Error ? error.message : String(error);
}

function renderControls() {
  ask.disabled = !ready || pending || !prompt.hidden || superdoc.ui.selection.getSnapshot().empty;
  download.disabled = !ready || pending;
  for (const control of prompt.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(
    'input, textarea, button',
  ))
    control.disabled = pending;
}

function renderFindings(findings: readonly ReviewFinding[]) {
  rows = findings;
  list.replaceChildren();
  for (const finding of findings) {
    const row = document.createElement('li');
    const summary = document.createElement('p');
    summary.textContent = `Simulated response: ${finding.payload.summary}`;
    const show = document.createElement('button');
    show.textContent = 'Show in document';
    show.disabled = pending || finding.anchorStatus !== 'resolved';
    show.onclick = () =>
      void run(async () => {
        const result = await superdoc.ui.metadata.scrollIntoView({ id: finding.id, block: 'center' });
        if (!result.success) throw new Error('The finding could not be shown.');
        status.textContent = 'Showing the finding.';
      });
    const suggest = document.createElement('button');
    suggest.textContent =
      finding.payload.suggestionStatus === 'pending'
        ? 'Check document'
        : finding.payload.suggestionStatus === 'created'
          ? 'Suggestion created'
          : 'Suggest edit';
    suggest.disabled = pending || finding.anchorStatus !== 'resolved' || Boolean(finding.payload.suggestionStatus);
    suggest.onclick = () =>
      void run(async () => {
        const result = await review.suggest(superdoc.activeEditor?.doc, finding);
        if (!result.success) throw new Error(result.message);
        status.textContent = 'Tracked suggestion added. Review it with the built-in toolbar.';
        await refresh();
      });
    row.append(summary, show, suggest);
    list.append(row);
  }
}

async function refresh() {
  renderFindings(await review.refresh(superdoc.activeEditor?.doc));
}

async function run(action: () => Promise<void>) {
  if (pending || !ready) return;
  pending = true;
  renderControls();
  renderFindings(rows);
  try {
    await action();
  } catch (error) {
    showError(error);
  } finally {
    pending = false;
    renderControls();
    renderFindings(rows);
  }
}

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/contract.docx',
  extensions: [review.extension],
  ui: { toolbar: { container: '#toolbar' } },
  user: { name: 'Review assistant', email: 'review-assistant@example.com' },
  onReady: () => {
    ready = true;
    stopSelection?.();
    stopSelection = superdoc.ui.selection.observe(renderControls);
    void run(async () => {
      await refresh();
      status.textContent = 'Select one short paragraph, then ask AI.';
    });
  },
  onContentError: ({ error }) => showError(error),
  onException: ({ error }) => showError(error),
});

function captureSelection() {
  const capture = superdoc.ui.selection.capture();
  selection = capture ? review.bindSelection(capture) : null;
}
ask.addEventListener('mousedown', captureSelection);
ask.addEventListener('click', (event) => {
  if (event.detail === 0) captureSelection();
  if (!selection) {
    status.textContent = 'Select plain body text in one paragraph.';
    return;
  }
  quote.textContent = selection.capture.quotedText;
  suggested.value = `${selection.capture.quotedText} (subject to the agreed limit)`;
  prompt.hidden = false;
  renderControls();
  question.focus();
});
cancel.onclick = () => {
  selection = null;
  prompt.hidden = true;
  renderControls();
};
prompt.onsubmit = (event) => {
  event.preventDefault();
  const boundSelection = selection;
  if (!boundSelection) return;
  void run(async () => {
    const result = await review.save(superdoc.activeEditor?.doc, boundSelection, {
      question: question.value,
      quote: boundSelection.capture.quotedText,
      summary: 'Consider whether this wording needs a clearer limit.',
      suggestedText: suggested.value,
    });
    if (!result.success) throw new Error(result.message);
    selection = null;
    prompt.hidden = true;
    await refresh();
    status.textContent = 'Finding saved in the document.';
  });
};
download.onclick = () =>
  void run(async () => {
    await superdoc.export({ exportType: ['docx'], triggerDownload: true });
    status.textContent = 'DOCX downloaded.';
  });
window.addEventListener('beforeunload', () => {
  stopSelection?.();
  superdoc.destroy();
});
