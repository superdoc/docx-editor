import { useRef, useState } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import type { UIConfig } from 'superdoc';
import type { DocumentSlice } from 'superdoc/ui';
import {
  SuperDocUIProvider,
  useSetSuperDoc,
  useSuperDocDocument,
  useSuperDocUI,
  useSuperDocZoom,
} from 'superdoc/ui/react';
import '@superdoc/react/style.css';

const editorUi = {
  toolbar: { excludeItems: ['zoom'] },
} satisfies UIConfig;

function modeLabel(mode: DocumentSlice['mode']) {
  if (mode === 'editing') return 'Editing';
  if (mode === 'suggesting') return 'Suggesting';
  if (mode === 'viewing') return 'Viewing';
  return 'Ready';
}

export default function App() {
  const [errorMessage, setErrorMessage] = useState('');

  return (
    <SuperDocUIProvider>
      <DocumentControls errorMessage={errorMessage} />
      <Editor onError={setErrorMessage} />
    </SuperDocUIProvider>
  );
}

function DocumentControls({ errorMessage }: { errorMessage: string }) {
  const ui = useSuperDocUI();
  const zoom = useSuperDocZoom();
  const documentState = useSuperDocDocument();
  const [actionMessage, setActionMessage] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const exportInFlight = useRef(false);

  function changeZoom(delta: number) {
    ui?.zoom.set(Math.min(zoom.max, Math.max(zoom.min, zoom.value + delta)));
  }

  async function downloadDocx() {
    if (exportInFlight.current) return;

    exportInFlight.current = true;
    setIsExporting(true);
    setActionMessage('Preparing the DOCX…');
    try {
      const pendingExport = ui?.document.export({ exportType: ['docx'], triggerDownload: true });
      if (!pendingExport) {
        setActionMessage('Export is unavailable in this host.');
        return;
      }
      await pendingExport;
      setActionMessage('DOCX downloaded.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'The DOCX could not be exported.');
    } finally {
      exportInFlight.current = false;
      setIsExporting(false);
    }
  }

  const status = documentState.ready
    ? `${modeLabel(documentState.mode)} · ${zoom.value}%${actionMessage ? ` · ${actionMessage}` : ''}`
    : 'Loading the document…';

  return (
    <>
      <div aria-label='Document controls' role='toolbar'>
        <button disabled={!ui || zoom.value <= zoom.min} onClick={() => changeZoom(-10)} type='button'>
          Zoom out
        </button>
        <button disabled={!ui || zoom.value >= zoom.max} onClick={() => changeZoom(10)} type='button'>
          Zoom in
        </button>
        <button disabled={!ui || !documentState.ready || isExporting} onClick={() => void downloadDocx()} type='button'>
          Download DOCX
        </button>
        <output aria-live='polite' role='status'>
          {status}
        </output>
      </div>
      {errorMessage ? <p role='alert'>{errorMessage}</p> : null}
    </>
  );
}

function Editor({ onError }: { onError: (message: string) => void }) {
  const setSuperDoc = useSetSuperDoc();

  return (
    <SuperDocEditor
      document='/sample.docx'
      onContentError={({ error }) => {
        onError('The document could not be read or updated.');
        console.error(error);
      }}
      onException={({ error }) => {
        onError('The editor reported a runtime error.');
        console.error(error);
      }}
      onReady={({ superdoc }) => {
        onError('');
        setSuperDoc(superdoc);
      }}
      ui={editorUi}
    />
  );
}
