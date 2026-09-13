import { useEffect, useState } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import type { UIConfig } from 'superdoc';
import type { CommandExecutionResult, TrackChangesItem } from 'superdoc/ui';
import { SuperDocUIProvider, useSetSuperDoc, useSuperDocTrackChanges, useSuperDocUI } from 'superdoc/ui/react';
import '@superdoc/react/style.css';

const editorUi = { comments: false } satisfies UIConfig;
const currentUser = { name: 'Alex Rivera', email: 'alex@example.com' };
type Decision = 'accept' | 'reject';

function decisionFailure(result: CommandExecutionResult): string | null {
  if (result === false) return 'The review decision is unavailable.';
  if (result === true || result.success) return null;
  return result.failure.message;
}

/** A row's exact occurrence: the id plus its story when the change is outside the body. */
function decisionTarget(change: TrackChangesItem): { id: string; story?: unknown } {
  const story = change.address?.story;
  return story ? { id: change.id, story } : { id: change.id };
}

/** Stable per-occurrence key. The same id can appear in the body and in a footnote or header. */
function rowKey(change: TrackChangesItem): string {
  return `${change.id}:${JSON.stringify(change.address?.story ?? null)}`;
}

type ActiveRow = { id: string; key: string };

/** Whether this row is the active occurrence, not merely a row sharing the active id. */
function isActiveRow(change: TrackChangesItem, activeId: string | null, activeRow: ActiveRow | null): boolean {
  if (change.id !== activeId) return false;
  return activeRow === null || activeRow.id !== activeId || activeRow.key === rowKey(change);
}

export default function App() {
  const [loadError, setLoadError] = useState<string | null>(null);

  return (
    <SuperDocUIProvider>
      <main className='review-layout'>
        <Editor onLoadError={setLoadError} />
        <ReviewPanel loadError={loadError} />
      </main>
    </SuperDocUIProvider>
  );
}

function Editor({ onLoadError }: { onLoadError: (message: string) => void }) {
  const setSuperDoc = useSetSuperDoc();

  return (
    <SuperDocEditor
      document='/contract.docx'
      documentMode='suggesting'
      onContentError={() => onLoadError('The document could not be opened.')}
      onException={() => onLoadError('The document could not be opened.')}
      onReady={({ superdoc }) => setSuperDoc(superdoc)}
      ui={editorUi}
      user={currentUser}
    />
  );
}

function ReviewPanel({ loadError }: { loadError: string | null }) {
  const ui = useSuperDocUI();
  const changes = useSuperDocTrackChanges();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);
  // The occurrence this panel focused. `activeId` alone cannot tell a body row
  // from a same-id footnote or header row, so the panel remembers which one it
  // asked for and only trusts it while the controller still reports that id.
  const [activeRow, setActiveRow] = useState<ActiveRow | null>(null);
  const [status, setStatus] = useState('Choose a change to review it.');

  useEffect(() => {
    if (loadError) setStatus(loadError);
  }, [loadError]);

  async function showChange(change: TrackChangesItem) {
    if (pendingKey) return;
    // The row's { id, story } pins the clicked occurrence for both focus and
    // reveal when the same id appears in the body and a footnote or header.
    const target = decisionTarget(change);
    if (!ui?.trackChanges.setActive(target)) {
      setStatus('The tracked change is no longer available.');
      return;
    }
    setActiveRow({ id: change.id, key: rowKey(change) });

    const result = await ui.trackChanges.scrollTo(target);
    setStatus(
      result.success
        ? 'Showing the change in the document.'
        : (result.reason ?? 'The tracked change could not be shown.'),
    );
  }

  async function navigate(direction: 'previous' | 'next') {
    if (!ui || pendingKey) return;
    // Navigation picks the occurrence, so the panel stops asserting its own.
    setActiveRow(null);
    const result =
      direction === 'previous' ? await ui.trackChanges.navigatePrevious() : await ui.trackChanges.navigateNext();
    setStatus(result.success ? `Showing the ${direction} change.` : 'No tracked change could be shown.');
  }

  async function decideChange(decision: Decision, change: TrackChangesItem) {
    if (!ui || pendingKey) return;
    setPendingKey(rowKey(change));
    setPendingDecision(decision);
    setStatus(decision === 'accept' ? 'Accepting change...' : 'Rejecting change...');

    // The async form resolves once the document operation settles, so a late
    // failure still clears the pending state and reaches the reader.
    const target = decisionTarget(change);
    const result =
      decision === 'accept' ? await ui.trackChanges.acceptAsync(target) : await ui.trackChanges.rejectAsync(target);

    setPendingKey(null);
    setPendingDecision(null);
    setStatus(decisionFailure(result) ?? (decision === 'accept' ? 'Change accepted.' : 'Change rejected.'));
  }

  return (
    <aside aria-labelledby='review-heading'>
      <h2 id='review-heading'>Review changes</h2>
      <p>
        {loadError
          ? 'Document unavailable'
          : changes.status === 'pending'
            ? 'Loading changes...'
            : `${changes.total} open ${changes.total === 1 ? 'change' : 'changes'}`}
      </p>

      <nav aria-label='Tracked change navigation'>
        <button
          disabled={!ui || changes.status === 'pending' || changes.total === 0 || pendingKey !== null}
          onClick={() => void navigate('previous')}
          type='button'
        >
          Previous
        </button>
        <button
          disabled={!ui || changes.status === 'pending' || changes.total === 0 || pendingKey !== null}
          onClick={() => void navigate('next')}
          type='button'
        >
          Next
        </button>
      </nav>

      <ul>
        {changes.items.map((change) => {
          const detail =
            change.excerpt ?? change.insertedText ?? change.deletedText ?? change.formattingDeltaSummary ?? change.type;
          const active = isActiveRow(change, changes.activeId, activeRow);
          const pending = pendingKey === rowKey(change) ? pendingDecision : null;

          return (
            <li aria-current={active ? 'true' : undefined} key={rowKey(change)}>
              <span>{`${detail}${change.author ? ` by ${change.author}` : ''}`}</span>
              <button disabled={pendingKey !== null} onClick={() => void showChange(change)} type='button'>
                {active ? 'Showing' : 'Show in document'}
              </button>
              <button disabled={pendingKey !== null} onClick={() => void decideChange('accept', change)} type='button'>
                {pending === 'accept' ? 'Accepting...' : 'Accept'}
              </button>
              <button disabled={pendingKey !== null} onClick={() => void decideChange('reject', change)} type='button'>
                {pending === 'reject' ? 'Rejecting...' : 'Reject'}
              </button>
            </li>
          );
        })}
      </ul>

      <p aria-live='polite' role='status'>
        {status}
      </p>
    </aside>
  );
}
