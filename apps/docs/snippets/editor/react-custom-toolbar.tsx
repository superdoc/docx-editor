import { useState } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import type { UIConfig } from 'superdoc';
import { SuperDocUIProvider, useSetSuperDoc, useSuperDocCommand } from 'superdoc/ui/react';
import '@superdoc/react/style.css';

const editorUi = {
  toolbar: { excludeItems: ['bold'] },
} satisfies UIConfig;

export default function App() {
  return (
    <SuperDocUIProvider>
      <BoldControl />
      <Editor />
    </SuperDocUIProvider>
  );
}

function BoldControl() {
  const bold = useSuperDocCommand('bold');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState({ id: 0, message: 'Select text to format it.' });

  async function toggleBold() {
    if (pending) return;
    const message = bold.active ? 'Bold removed.' : 'Bold applied.';
    setPending(true);
    try {
      const result = await bold.executeAsync();
      const applied = result === true || (typeof result === 'object' && result.success);
      setStatus((current) => ({ id: current.id + 1, message: applied ? message : 'Bold was not changed.' }));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div aria-label='Document controls' role='toolbar'>
        <button
          aria-pressed={bold.active}
          disabled={!bold.enabled || pending}
          onClick={() => void toggleBold()}
          onMouseDown={(event) => event.preventDefault()}
          title={bold.reason ?? 'Toggle bold'}
          type='button'
        >
          Bold
        </button>
      </div>
      <output aria-live='polite' role='status'>
        <span key={status.id}>{status.message}</span>
      </output>
    </>
  );
}

function Editor() {
  const setSuperDoc = useSetSuperDoc();

  return (
    <SuperDocEditor
      document='/sample.docx'
      onContentError={({ error }) => console.error('SuperDoc could not open the document.', error)}
      onException={({ error }) => console.error('SuperDoc could not open the document.', error)}
      onReady={({ superdoc }) => setSuperDoc(superdoc)}
      ui={editorUi}
    />
  );
}
