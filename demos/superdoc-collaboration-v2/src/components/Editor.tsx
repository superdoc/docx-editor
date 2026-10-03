import { useEffect, useRef, useState } from 'react';
import { SuperDoc } from 'superdoc';
import { useSetSuperDoc } from 'superdoc/ui/react';

export function Editor({
  roomId,
  roomMode,
  sourceUrl,
}: {
  roomId: string;
  roomMode: 'create' | 'join';
  sourceUrl: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const setSuperDoc = useSetSuperDoc();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mountRef.current) return;

    const superdoc = new SuperDoc({
      selector: mountRef.current,
      document: {
        id: roomId,
        type: 'docx',
        url: sourceUrl,
        v2Collaboration: {
          providerType: 'hocuspocus',
          documentId: roomId,
          serverUrl: import.meta.env.VITE_COLLAB_URL ?? 'ws://127.0.0.1:3101',
          token: 'demo',
          roomMode,
        },
      },
      documentMode: 'editing',
      rulers: true,
      rulerContainer: rulerRef.current ?? undefined,
      ui: {
        toolbar: {
          container: '#default-toolbar',
          hideButtons: false,
          texts: {
            clearFormatting: '',
            numberedList: '',
            bulletList: '',
            indentLeft: '',
            indentRight: '',
            lineHeight: '',
          },
          groups: {
            center: ['clearFormatting', 'numberedlist', 'list', 'indentleft', 'indentright', 'lineHeight'],
          },
        },
        comments: true,
        ruler: true,
      },
      onReady: ({ superdoc: readySuperDoc }) => setSuperDoc(readySuperDoc),
      onException: ({ error: loadError }) => {
        console.error(loadError);
        setError('The document could not be opened.');
      },
    });

    return () => superdoc.destroy();
  }, [roomId, roomMode, setSuperDoc, sourceUrl]);

  return (
    <main className='document-stage'>
      {error ? <div className='error-banner'>{error}</div> : null}
      <div ref={rulerRef} className='fixed-ruler' aria-label='Document ruler' />
      <div ref={mountRef} className='editor-mount' aria-label='Collaborative document' />
    </main>
  );
}
