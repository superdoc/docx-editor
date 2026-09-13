import { useEffect, useRef, useState } from 'react';
import { SuperDocEditor, type SuperDocRef } from '@superdoc/react';
import '@superdoc/react/style.css';

const endpoint = '/api/documents/sample';
const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export default function App() {
  const editorRef = useRef<SuperDocRef>(null);
  const editRevisionRef = useRef(0);
  const savingRef = useRef(false);
  const [document, setDocument] = useState<Blob>();
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    void fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load the document: ${response.status}`);
        setDocument(new Blob([await response.arrayBuffer()], { type: docxType }));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(true);
          console.error(error);
        }
      });

    return () => controller.abort();
  }, []);

  function showOpenError({ error }: { error: unknown }) {
    console.error('Could not open the document.', error);
    setReady(false);
    setLoadError(true);
  }

  async function saveDocument() {
    if (savingRef.current) return;

    const superdoc = editorRef.current?.getInstance();
    if (!superdoc) return;

    const savedRevision = editRevisionRef.current;
    savingRef.current = true;
    setSaving(true);
    setSaveStatus('Saving…');
    try {
      const editedDocx = await superdoc.export({
        exportType: ['docx'],
        triggerDownload: false,
      });
      if (!(editedDocx instanceof Blob)) throw new Error('Expected one DOCX file.');

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'content-type': docxType },
        body: editedDocx,
      });
      if (!response.ok) throw new Error(`Could not save the document: ${response.status}`);
      setSaveStatus(editRevisionRef.current === savedRevision ? 'Saved' : 'Unsaved changes');
    } catch (error) {
      setSaveStatus('Save failed. Try again.');
      console.error('Could not confirm the document was saved.', error);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (loadError) return <p>Could not open the document. Reload to try again.</p>;
  if (!document) return <p>Opening document…</p>;

  return (
    <>
      <button disabled={!ready || saving} onClick={() => void saveDocument()} type='button'>
        Save DOCX
      </button>
      <output aria-live='polite'>{saveStatus}</output>
      <SuperDocEditor
        document={document}
        onContentError={showOpenError}
        onEditorUpdate={() => {
          editRevisionRef.current += 1;
          setSaveStatus('Unsaved changes');
        }}
        onException={showOpenError}
        onReady={() => setReady(true)}
        ref={editorRef}
      />
    </>
  );
}
