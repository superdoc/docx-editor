import { useRef, useState } from 'react';
import { SuperDocEditor, type SuperDocConfig, type SuperDocRef } from '@superdoc/react';
import '@superdoc/react/style.css';

const documentFonts = {
  families: [
    {
      family: 'Inter',
      faces: [
        { source: '/fonts/inter-regular.woff2', weight: 400, style: 'normal' },
        { source: '/fonts/inter-bold.woff2', weight: 700, style: 'normal' },
      ],
    },
  ],
  map: {
    Aptos: 'Inter',
    'Aptos Display': 'Inter',
  },
} satisfies NonNullable<SuperDocConfig['fonts']>;

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
        fonts={documentFonts}
        onContentError={({ error }) => console.error('SuperDoc could not open the document.', error)}
        onException={({ error }) => console.error('SuperDoc could not open the document.', error)}
        onReady={() => setReady(true)}
        ref={editorRef}
      />
    </main>
  );
}
