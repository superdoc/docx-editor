import { SuperDoc } from 'superdoc';
import type { DocumentMode } from 'superdoc';
import 'superdoc/style.css';

const modeSelect = document.querySelector<HTMLSelectElement>('#document-mode');
const exportButton = document.querySelector<HTMLButtonElement>('#export-docx');
const status = document.querySelector<HTMLSpanElement>('#status');

if (!modeSelect || !exportButton || !status) throw new Error('The document mode controls are missing.');

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  documentMode: 'editing',
  user: { name: 'Jordan Lee', email: 'jordan@example.com' },
  onReady: () => {
    modeSelect.disabled = false;
    exportButton.disabled = false;
    status.textContent = 'Editing mode.';
  },
  onException: ({ error }) => {
    status.textContent = 'The document could not be opened.';
    console.error(error);
  },
});

modeSelect.addEventListener('change', () => {
  superdoc.setDocumentMode(modeSelect.value as DocumentMode);
});

superdoc.on('document-mode-change', ({ documentMode }) => {
  status.textContent = `${documentMode[0].toUpperCase()}${documentMode.slice(1)} mode.`;
});

exportButton.addEventListener('click', async () => {
  exportButton.disabled = true;
  try {
    await superdoc.export({ exportType: ['docx'], exportedName: 'document-modes' });
  } finally {
    exportButton.disabled = false;
  }
});

window.addEventListener('beforeunload', () => superdoc.destroy());
