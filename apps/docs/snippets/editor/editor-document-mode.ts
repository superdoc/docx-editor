import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

const exportButton = document.querySelector<HTMLButtonElement>('#export-docx');
const viewingButton = document.createElement('button');
viewingButton.type = 'button';
viewingButton.textContent = 'Switch to viewing';
viewingButton.disabled = true;

if (!exportButton) throw new Error('The export button is missing.');
exportButton.before(viewingButton);

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  documentMode: 'suggesting',
  user: { name: 'Jordan Lee', email: 'jordan@example.com' },
  viewing: {
    comments: true,
    trackedChanges: 'markup',
  },
  onReady: () => {
    exportButton.disabled = false;
    viewingButton.disabled = false;
  },
  onContentError: ({ error }) => console.error('SuperDoc could not open the document.', error),
  onException: ({ error }) => console.error('SuperDoc could not open the document.', error),
});

viewingButton.addEventListener('click', () => {
  superdoc.setDocumentMode('viewing');
  viewingButton.disabled = true;
});

exportButton.addEventListener('click', async () => {
  exportButton.disabled = true;
  try {
    await superdoc.export({ exportType: ['docx'], exportedName: 'sample-edited' });
  } catch (error) {
    console.error('SuperDoc could not export the document.', error);
  } finally {
    exportButton.disabled = false;
  }
});

window.addEventListener('beforeunload', () => superdoc.destroy());
