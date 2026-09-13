import { useEffect, useState } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import type { UIConfig } from 'superdoc';
import type { WorkflowActionResult } from 'superdoc/ui';
import { SuperDocUIProvider, useSetSuperDoc, useSuperDocSearch, useSuperDocUI } from 'superdoc/ui/react';
import '@superdoc/react/style.css';

const editorUi = { search: false } satisfies UIConfig;

export default function App() {
  return (
    <SuperDocUIProvider>
      <main className='search-layout'>
        <SearchControls />
        <Editor />
      </main>
    </SuperDocUIProvider>
  );
}

function Editor() {
  const setSuperDoc = useSetSuperDoc();

  return (
    <SuperDocEditor
      document='/search-sample.docx'
      onContentError={({ error }) => console.error('SuperDoc could not open the document.', error)}
      onException={({ error }) => console.error('SuperDoc could not open the document.', error)}
      onReady={({ superdoc }) => setSuperDoc(superdoc)}
      ui={editorUi}
    />
  );
}

function SearchControls() {
  const ui = useSuperDocUI();
  const search = useSuperDocSearch();
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [includeDeletions, setIncludeDeletions] = useState(false);
  const [replacementPending, setReplacementPending] = useState(false);
  const [status, setStatus] = useState('');

  // Runs on mount, whenever the query or its options change, and again once
  // the Editor becomes ready, so text typed while loading still searches.
  useEffect(() => {
    if (!ui) return;
    setStatus('');
    if (!query) {
      ui.search.clear();
      return;
    }
    ui.search.find(query, { caseSensitive: matchCase, includeTrackedDeletions: includeDeletions });
  }, [includeDeletions, matchCase, query, ui]);

  useEffect(() => () => ui?.search.close(), [ui]);

  function report(result: WorkflowActionResult) {
    setStatus(result.ok ? '' : (result.reason ?? 'The search action is unavailable.'));
  }

  function goPrevious() {
    if (ui && !replacementPending) report(ui.search.previous());
  }

  function goNext() {
    if (ui && !replacementPending) report(ui.search.next());
  }

  async function runReplacement(action: () => WorkflowActionResult | Promise<WorkflowActionResult>) {
    if (replacementPending) return;
    setReplacementPending(true);
    try {
      report(await action());
    } finally {
      setReplacementPending(false);
    }
  }

  function replaceCurrent() {
    if (ui) return runReplacement(() => ui.search.replace(replacement));
  }

  function replaceEveryMatch() {
    if (ui) return runReplacement(() => ui.search.replaceAll(replacement));
  }

  const hasMatches = search.total > 0;
  const matchCount =
    search.activeIndex >= 0 ? `${search.activeIndex + 1} of ${search.total}` : `${search.total} matches`;

  return (
    <form onSubmit={(event) => event.preventDefault()} role='search'>
      <input
        aria-label='Find in document'
        disabled={replacementPending}
        onChange={(event) => setQuery(event.target.value)}
        placeholder='Find in document'
        type='search'
        value={query}
      />
      <label>
        <input
          checked={matchCase}
          disabled={replacementPending}
          onChange={(event) => setMatchCase(event.target.checked)}
          type='checkbox'
        />
        Match case
      </label>
      <label>
        <input
          checked={includeDeletions}
          disabled={replacementPending}
          onChange={(event) => setIncludeDeletions(event.target.checked)}
          type='checkbox'
        />
        Include pending deletions
      </label>
      <button disabled={!hasMatches || replacementPending} onClick={goPrevious} type='button'>
        Previous
      </button>
      <button disabled={!hasMatches || replacementPending} onClick={goNext} type='button'>
        Next
      </button>
      <output>{hasMatches ? matchCount : 'No matches'}</output>

      <input
        aria-label='Replacement text'
        disabled={replacementPending}
        onChange={(event) => setReplacement(event.target.value)}
        placeholder='Replacement'
        type='text'
        value={replacement}
      />
      <button
        disabled={!hasMatches || !search.canReplace || replacementPending}
        onClick={() => void replaceCurrent()}
        type='button'
      >
        {replacementPending ? 'Replacing…' : 'Replace'}
      </button>
      <button
        disabled={!search.canReplaceAll || replacementPending}
        onClick={() => void replaceEveryMatch()}
        type='button'
      >
        Replace all
      </button>
      <p aria-live='polite' role='status'>
        {search.reason ?? status}
      </p>
    </form>
  );
}
