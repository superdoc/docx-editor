import { useRef, useState } from 'react';
import { SuperDocEditor, type SuperDocRef, type ToolbarConfig } from '@superdoc/react';
import '@superdoc/react/style.css';

const toolbar = {
  items: {
    left: ['undo', 'redo'],
    center: ['bold', 'italic', 'underline', 'link', 'image', 'table', 'table-actions'],
    right: ['document-mode', 'zoom'],
  },
  responsiveTo: 'container',
} satisfies ToolbarConfig;

const ui = { toolbar };

function reportDocumentError({ error }: { error: unknown }) {
  console.error('SuperDoc could not open the document.', error);
}

function withImageMimeType(file: File): Blob {
  const type = file.type.toLowerCase();
  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/jpg') return file;
  if (type) throw new Error('Choose a PNG or JPEG image.');
  if (/\.png$/i.test(file.name)) return file.slice(0, file.size, 'image/png');
  if (/\.jpe?g$/i.test(file.name)) return file.slice(0, file.size, 'image/jpeg');
  throw new Error('Choose a PNG or JPEG image.');
}

function handleImageUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'));
    reader.readAsDataURL(withImageMimeType(file));
  });
}

export default function App() {
  const editorRef = useRef<SuperDocRef>(null);
  const exportingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function exportDocument() {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      await editorRef.current?.getInstance()?.export({ exportType: ['docx'], exportedName: 'sample-edited' });
    } catch (error) {
      console.error('SuperDoc could not export the document.', error);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  return (
    <main>
      <button disabled={!ready || exporting} onClick={() => void exportDocument()} type='button'>
        Export DOCX
      </button>
      <SuperDocEditor
        document='/sample.docx'
        handleImageUpload={handleImageUpload}
        onContentError={reportDocumentError}
        onException={reportDocumentError}
        onReady={() => setReady(true)}
        ref={editorRef}
        ui={ui}
      />
    </main>
  );
}
