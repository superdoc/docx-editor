import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

function requireElement<ElementType extends Element>(selector: string) {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`${selector} not found.`);
  return element;
}

const status = requireElement<HTMLOutputElement>('#editor-status');
const exportButton = requireElement<HTMLButtonElement>('#export-docx');

let isReady = false;
let hasUnsavedChanges = false;
let isExporting = false;
let isUnmounted = false;

function showLoadError(error: unknown) {
  console.error('SuperDoc error', error);
  if (isReady || isUnmounted) return;

  status.value = 'Could not open the document';
  exportButton.disabled = true;
}

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  onReady: () => {
    if (isUnmounted) return;
    isReady = true;
    status.value = 'Ready';
    exportButton.disabled = isExporting;
  },
  onEditorUpdate: () => {
    if (isUnmounted) return;
    hasUnsavedChanges = true;
    status.value = 'Unsaved changes';
  },
  onContentError: ({ error }) => showLoadError(error),
  onException: ({ error }) => showLoadError(error),
});

async function exportDocument(): Promise<void> {
  if (!isReady || isExporting || isUnmounted) return;

  isExporting = true;
  exportButton.disabled = true;
  try {
    await superdoc.export({ exportedName: 'sample-edited' });
    if (!isUnmounted) status.value = hasUnsavedChanges ? 'Unsaved changes' : 'Ready';
  } catch (error) {
    if (!isUnmounted) status.value = 'Export failed. Try again.';
    console.error('Could not export the document.', error);
  } finally {
    isExporting = false;
    if (!isUnmounted) exportButton.disabled = !isReady;
  }
}

exportButton.addEventListener('click', exportDocument);

export function unmountEditor(): void {
  isUnmounted = true;
  exportButton.disabled = true;
  exportButton.removeEventListener('click', exportDocument);
  superdoc.destroy();
}
