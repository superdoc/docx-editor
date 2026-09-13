import { useRef, useState } from 'react';
import { SuperDocEditor, type DocumentMode, type SuperDocRef } from '@superdoc/react';
import '@superdoc/react/style.css';

const user = { name: 'Jordan Lee', email: 'jordan@example.com' };

function reportDocumentError({ error }: { error: unknown }) {
  console.error('SuperDoc could not open the document.', error);
}

export default function App() {
  const editorRef = useRef<SuperDocRef>(null);
  const exportingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [documentMode, setDocumentMode] = useState<DocumentMode>('suggesting');

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
      <button disabled={!ready || documentMode === 'viewing'} onClick={() => setDocumentMode('viewing')} type='button'>
        Switch to viewing
      </button>
      <button disabled={!ready || exporting} onClick={() => void exportDocument()} type='button'>
        Export DOCX
      </button>
      <SuperDocEditor
        ref={editorRef}
        user={user}
        document='/sample.docx'
        documentMode={documentMode}
        onReady={() => setReady(true)}
        onContentError={reportDocumentError}
        onException={reportDocumentError}
        viewing={{
          comments: true,
          trackedChanges: 'markup',
        }}
      />
    </main>
  );
}
