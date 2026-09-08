'use client';

import { SuperDocEditor } from '@superdoc/react';
import '@superdoc/react/style.css';
import { useState } from 'react';

export default function App() {
  const [loadFailed, setLoadFailed] = useState(false);

  return (
    <SuperDocEditor
      document='/sample.docx'
      renderLoading={() =>
        loadFailed ? (
          <p role='alert'>Could not open the document. Reload the page to retry.</p>
        ) : (
          <p role='status'>Opening document…</p>
        )
      }
      onContentError={() => setLoadFailed(true)}
      onException={() => setLoadFailed(true)}
    />
  );
}
