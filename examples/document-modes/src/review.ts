import { SuperDoc } from 'superdoc';
import type { TrackChangesSlice } from 'superdoc/ui';
import 'superdoc/style.css';

const changes = document.querySelector<HTMLSelectElement>('#review-change')!;
const accept = document.querySelector<HTMLButtonElement>('#accept-change')!;
const reject = document.querySelector<HTMLButtonElement>('#reject-change')!;
const exportButton = document.querySelector<HTMLButtonElement>('#export-docx')!;
const status = document.querySelector<HTMLElement>('#status')!;
let snapshot: TrackChangesSlice | null = null;
let busy = false;
let stopObserving: (() => void) | undefined;

function render() {
  const selected = changes.value;
  changes.replaceChildren(...(snapshot?.items ?? []).map((item, index) => new Option(`Change ${index + 1}`, item.id)));
  if (snapshot?.items.some((item) => item.id === selected)) changes.value = selected;
  const ready = snapshot?.status === 'ready';
  changes.disabled = busy || !ready || !changes.value;
  accept.disabled = reject.disabled = changes.disabled;
  exportButton.disabled = busy || !ready;
}

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/basic-review.docx',
  documentMode: 'suggesting',
  user: { name: 'Jordan Lee', email: 'jordan@example.com' },
  onReady: ({ superdoc: editor }) => {
    stopObserving = editor.ui.trackChanges.observe((next) => {
      snapshot = next;
      render();
    });
    status.textContent = 'Select a change to review, or type to propose an edit.';
  },
  onException: (failure) => {
    if ('diagnosticCode' in failure) return;
    status.textContent = 'The document could not be opened.';
    console.error(failure.error);
  },
});

changes.addEventListener('change', () => superdoc.ui.trackChanges.setActive(changes.value));

async function decide(decision: 'accept' | 'reject') {
  if (busy || !changes.value) return;
  const id = changes.value;
  busy = true;
  render();
  try {
    const result = await (decision === 'accept'
      ? superdoc.ui.trackChanges.acceptAsync(id)
      : superdoc.ui.trackChanges.rejectAsync(id));
    const succeeded = result === true || (typeof result === 'object' && result.success);
    status.textContent = succeeded
      ? 'Decision applied. Export to keep the result.'
      : 'The change could not be decided.';
  } catch {
    status.textContent = 'The change could not be decided.';
  } finally {
    busy = false;
    render();
  }
}

accept.addEventListener('click', () => void decide('accept'));
reject.addEventListener('click', () => void decide('reject'));
exportButton.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  render();
  try {
    await superdoc.export({ exportType: ['docx'], exportedName: 'reviewed-document' });
    status.textContent = 'DOCX exported. Undecided proposals remain in the file.';
  } catch {
    status.textContent = 'The DOCX could not be exported.';
  } finally {
    busy = false;
    render();
  }
});

window.addEventListener('beforeunload', () => {
  stopObserving?.();
  superdoc.destroy();
});
