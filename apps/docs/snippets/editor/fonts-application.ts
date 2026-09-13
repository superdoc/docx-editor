import { SuperDoc, type Config } from 'superdoc';
import 'superdoc/style.css';

const exportButton = document.querySelector<HTMLButtonElement>('#export-docx');

if (!exportButton) throw new Error('The export button is missing.');

const documentFonts = {
  families: [
    {
      family: 'Aptos',
      faces: [
        { source: '/fonts/aptos-regular.woff2', weight: 400, style: 'normal' },
        { source: '/fonts/aptos-bold.woff2', weight: 700, style: 'normal' },
      ],
    },
    {
      family: 'Aptos Display',
      faces: [{ source: '/fonts/aptos-display.woff2', weight: 400, style: 'normal' }],
    },
  ],
} satisfies NonNullable<Config['fonts']>;

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  fonts: documentFonts,
  onReady: () => {
    exportButton.disabled = false;
  },
  onContentError: ({ error }) => {
    console.error('SuperDoc could not open the document.', error);
  },
  onException: ({ error }) => {
    console.error('SuperDoc could not open the document.', error);
  },
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
