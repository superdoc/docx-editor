import { DOCX, SuperDoc } from 'superdoc';
import 'superdoc/style.css';

function requireElement<ElementType extends Element>(selector: string) {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`${selector} not found.`);
  return element;
}

const saveButton = requireElement<HTMLButtonElement>('#save-docx');
const status = requireElement<HTMLOutputElement>('#document-status');

const endpoint = '/api/documents/sample';
let isReady = false;
let superdoc: SuperDoc | undefined;
let stopObservingDocument: (() => void) | undefined;

function showOpenError(error: unknown) {
  console.error('Could not open the document.', error);
  if (isReady) return;

  status.value = 'Could not open the document. Reload to try again.';
  saveButton.disabled = true;
}

try {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Could not load the document: ${response.status}`);

  const docx = new Blob([await response.arrayBuffer()], { type: DOCX });
  superdoc = new SuperDoc({
    selector: '#editor',
    document: docx,
    onReady: ({ superdoc: ready }) => {
      isReady = true;
      status.value = 'Ready';
      saveButton.disabled = false;
      stopObservingDocument?.();
      stopObservingDocument = ready.ui.document.observe(({ dirty }) => {
        status.value = dirty ? 'Unsaved changes' : 'Saved';
      });
    },
    onContentError: ({ error }) => showOpenError(error),
    onException: ({ error }) => showOpenError(error),
  });
} catch (error) {
  showOpenError(error);
}

saveButton.addEventListener('click', async () => {
  if (!superdoc || !isReady) return;

  const version = superdoc.ui.document.getVersion();
  saveButton.disabled = true;
  status.value = 'Saving…';

  try {
    const editedDocx = await superdoc.export({
      exportType: ['docx'],
      triggerDownload: false,
    });
    if (!(editedDocx instanceof Blob)) throw new Error('Expected one DOCX file.');

    const saveResponse = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'content-type': DOCX },
      body: editedDocx,
    });
    if (!saveResponse.ok) throw new Error(`Could not save the document: ${saveResponse.status}`);
    if (version) superdoc.ui.document.markClean(version);
    status.value = superdoc.ui.document.getSnapshot().dirty ? 'Unsaved changes' : 'Saved';
  } catch (error) {
    status.value = 'Save failed. Try again.';
    console.error('Could not confirm the document was saved.', error);
  } finally {
    saveButton.disabled = false;
  }
});

window.addEventListener('beforeunload', () => superdoc?.destroy());
