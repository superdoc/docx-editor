import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

function requireElement<ElementType extends HTMLElement>(selector: string) {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`${selector} not found.`);
  return element;
}

const editor = requireElement<HTMLElement>('#editor');
const status = requireElement<HTMLElement>('#document-status');
const fileInput = requireElement<HTMLInputElement>('#document-file');
let hasOpened = false;
let replacing = false;

function showLoading() {
  fileInput.disabled = true;
  editor.hidden = true;
  status.hidden = false;
  status.textContent = 'Opening document…';
}

function showEditor() {
  hasOpened = true;
  fileInput.disabled = replacing;
  status.hidden = true;
  editor.hidden = false;
}

function showError(error: unknown) {
  console.error('Could not open the document.', error);
  fileInput.disabled = !hasOpened || replacing;
  editor.hidden = true;
  status.hidden = false;
  status.textContent = hasOpened
    ? 'Could not open the document. Choose another DOCX to retry.'
    : 'Could not open the document. Reload the page to retry.';
}

const superdoc = new SuperDoc({
  selector: editor,
  document: '/sample.docx',
  ui: { loading: false },
  onReady: showEditor,
  onContentError: ({ error }) => showError(error),
  onException: (payload) => {
    const runtimeOnly = 'itemName' in payload || 'source' in payload || 'diagnosticCode' in payload;
    if (!hasOpened && !runtimeOnly) showError(payload.error);
    else console.error('SuperDoc reported an exception.', payload);
  },
});

async function replaceDocument(file: File) {
  if (replacing) return;
  replacing = true;
  showLoading();
  try {
    const result = await superdoc.replaceFile(file);
    const state = result && typeof result === 'object' ? (result as { state?: unknown }).state : undefined;
    const replaced = state === undefined || state === null || state === 'review-ready' || state === 'editing-ready';
    if (!replaced) throw new Error('SuperDoc could not replace the document.');
    showEditor();
  } catch (error) {
    showError(error);
  } finally {
    replacing = false;
    fileInput.disabled = !hasOpened;
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void replaceDocument(file);
  fileInput.value = '';
});

window.addEventListener('beforeunload', () => superdoc.destroy());
