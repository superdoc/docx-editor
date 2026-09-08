import { SuperDoc } from 'superdoc';
import type { UIConfig } from 'superdoc';
import type { CommandExecutionResult, TrackChangesItem, TrackChangesSlice } from 'superdoc/ui';
import 'superdoc/style.css';

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing review panel element: ${selector}`);
  return element;
}

const toolbar = getElement<HTMLDivElement>('#toolbar');
const changeCount = getElement<HTMLParagraphElement>('#change-count');
const changeList = getElement<HTMLUListElement>('#change-list');
const previousChange = getElement<HTMLButtonElement>('#previous-change');
const nextChange = getElement<HTMLButtonElement>('#next-change');
const reviewStatus = getElement<HTMLParagraphElement>('#review-status');

const editorUi = {
  comments: false,
  toolbar: { container: toolbar, responsiveTo: 'container' },
} satisfies UIConfig;
type Decision = 'accept' | 'reject';

let pendingDecision: { key: string; decision: Decision } | null = null;
// The occurrence this panel focused. `activeId` alone cannot tell a body row
// from a same-id footnote or header row, so the panel remembers which one it
// asked for and only trusts it while the controller still reports that id.
let activeRow: { id: string; key: string } | null = null;
let stopTrackChanges: (() => void) | null = null;
// The last snapshot from `observe()`. It is the complete review directory;
// the passive snapshot is bounded to the painted page window.
let lastChanges: TrackChangesSlice | null = null;

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

/** Whether this row is the active occurrence, not merely a row sharing the active id. */
function isActiveRow(change: TrackChangesItem, activeId: string | null): boolean {
  if (change.id !== activeId) return false;
  return activeRow === null || activeRow.id !== activeId || activeRow.key === rowKey(change);
}

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/contract.docx',
  documentMode: 'suggesting',
  ui: editorUi,
  user: { name: 'Alex Rivera', email: 'alex@example.com' },
  onReady: ({ superdoc: readySuperDoc }) => {
    stopTrackChanges?.();
    const { ui } = readySuperDoc;

    const showChange = async (change: TrackChangesItem) => {
      if (pendingDecision) return;
      // The row's { id, story } pins the clicked occurrence for both focus and
      // reveal when the same id appears in the body and a footnote or header.
      const target = decisionTarget(change);
      if (!ui.trackChanges.setActive(target)) {
        reviewStatus.textContent = 'The tracked change is no longer available.';
        return;
      }
      activeRow = { id: change.id, key: rowKey(change) };
      if (lastChanges) render(lastChanges);

      const result = await ui.trackChanges.scrollTo(target);
      reviewStatus.textContent = result.success
        ? 'Showing the change in the document.'
        : (result.reason ?? 'The tracked change could not be shown.');
    };

    const navigate = async (direction: 'previous' | 'next') => {
      if (pendingDecision) return;
      // Navigation picks the occurrence, so the panel stops asserting its own.
      activeRow = null;
      const result =
        direction === 'previous' ? await ui.trackChanges.navigatePrevious() : await ui.trackChanges.navigateNext();
      reviewStatus.textContent = result.success
        ? `Showing the ${direction} change.`
        : 'No tracked change could be shown.';
    };

    const decideChange = async (decision: Decision, change: TrackChangesItem) => {
      if (pendingDecision) return;
      pendingDecision = { key: rowKey(change), decision };
      reviewStatus.textContent = decision === 'accept' ? 'Accepting change...' : 'Rejecting change...';
      if (lastChanges) render(lastChanges);

      // The async form resolves once the document operation settles, so a
      // late failure still clears the pending state and reaches the reader.
      const target = decisionTarget(change);
      const result =
        decision === 'accept' ? await ui.trackChanges.acceptAsync(target) : await ui.trackChanges.rejectAsync(target);

      pendingDecision = null;
      reviewStatus.textContent =
        decisionFailure(result) ?? (decision === 'accept' ? 'Change accepted.' : 'Change rejected.');
      if (lastChanges) render(lastChanges);
    };

    const render = (changes: TrackChangesSlice) => {
      lastChanges = changes;
      changeCount.textContent =
        changes.status === 'pending'
          ? 'Loading changes...'
          : `${changes.total} open ${changes.total === 1 ? 'change' : 'changes'}`;
      changeList.replaceChildren();
      previousChange.disabled = changes.status === 'pending' || changes.total === 0 || pendingDecision !== null;
      nextChange.disabled = previousChange.disabled;

      for (const change of changes.items) {
        const row = document.createElement('li');
        const summary = document.createElement('span');
        const show = document.createElement('button');
        const accept = document.createElement('button');
        const reject = document.createElement('button');
        const detail =
          change.excerpt ?? change.insertedText ?? change.deletedText ?? change.formattingDeltaSummary ?? change.type;

        summary.textContent = `${detail}${change.author ? ` by ${change.author}` : ''}`;

        const active = isActiveRow(change, changes.activeId);
        const pending = pendingDecision?.key === rowKey(change) ? pendingDecision.decision : null;
        if (active) row.setAttribute('aria-current', 'true');

        show.type = 'button';
        show.textContent = active ? 'Showing' : 'Show in document';
        show.disabled = pendingDecision !== null;
        show.addEventListener('click', () => void showChange(change));

        accept.type = 'button';
        accept.textContent = pending === 'accept' ? 'Accepting...' : 'Accept';
        accept.disabled = pendingDecision !== null;
        accept.addEventListener('click', () => void decideChange('accept', change));

        reject.type = 'button';
        reject.textContent = pending === 'reject' ? 'Rejecting...' : 'Reject';
        reject.disabled = pendingDecision !== null;
        reject.addEventListener('click', () => void decideChange('reject', change));

        row.append(summary, show, accept, reject);
        changeList.append(row);
      }
    };

    stopTrackChanges = ui.trackChanges.observe(render);
    previousChange.addEventListener('click', () => void navigate('previous'));
    nextChange.addEventListener('click', () => void navigate('next'));
  },
  onContentError: ({ error }) => {
    reviewStatus.textContent = 'The document could not be opened.';
    console.error(error);
  },
  onException: ({ error }) => {
    reviewStatus.textContent = 'The document could not be opened.';
    console.error(error);
  },
});

window.addEventListener('beforeunload', () => {
  stopTrackChanges?.();
  superdoc.destroy();
});
