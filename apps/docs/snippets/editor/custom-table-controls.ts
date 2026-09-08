import { SuperDoc } from 'superdoc';
import type { CommandExecutionResult } from 'superdoc/ui';
import 'superdoc/style.css';

const tablePosition = document.querySelector<HTMLParagraphElement>('#table-position');
const addRowButton = document.querySelector<HTMLButtonElement>('#add-row');
const deleteRowButton = document.querySelector<HTMLButtonElement>('#delete-row');
const tableStatus = document.querySelector<HTMLParagraphElement>('#table-status');
const downloadButton = document.querySelector<HTMLButtonElement>('#download');

if (!tablePosition || !addRowButton || !deleteRowButton || !tableStatus || !downloadButton) {
  throw new Error('The table controls are incomplete.');
}

let stopAddRow: (() => void) | null = null;
let stopDeleteRow: (() => void) | null = null;
let removeHandlers: (() => void) | null = null;

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/contract.docx',
  onReady: ({ superdoc: readySuperDoc }) => {
    downloadButton.disabled = false;
    const ui = readySuperDoc.ui;
    const addRow = ui.commands.get('table-add-row-after');
    const deleteRow = ui.commands.get('table-delete-row');

    const render = () => {
      const context = ui.tables.getContext();
      const addState = addRow.getState();
      const deleteState = deleteRow.getState();

      tablePosition.textContent = context.inTable
        ? `Row ${(context.rowIndex ?? 0) + 1}, column ${(context.columnIndex ?? 0) + 1}`
        : 'Place the caret in a table.';
      addRowButton.disabled = !addState.enabled;
      deleteRowButton.disabled = !deleteState.enabled;
      tableStatus.textContent = addState.reason ?? deleteState.reason ?? '';
    };

    const report = (result: CommandExecutionResult, successMessage: string) => {
      if (result === false) {
        tableStatus.textContent = 'The table action is unavailable.';
        return;
      }
      if (typeof result === 'object' && !result.success) {
        tableStatus.textContent = result.failure.message;
        return;
      }
      tableStatus.textContent = successMessage;
    };

    const insertRow = async () => report(await addRow.executeAsync(), 'Row added.');
    const removeRow = async () => report(await deleteRow.executeAsync(), 'Row deleted.');

    stopAddRow = addRow.observe(render);
    stopDeleteRow = deleteRow.observe(render);
    addRowButton.addEventListener('click', insertRow);
    deleteRowButton.addEventListener('click', removeRow);

    removeHandlers = () => {
      addRowButton.removeEventListener('click', insertRow);
      deleteRowButton.removeEventListener('click', removeRow);
    };
  },
});

downloadButton.addEventListener('click', async () => {
  downloadButton.disabled = true;
  try {
    const file = await superdoc.export({ triggerDownload: true });
    tableStatus.textContent = file ? 'DOCX downloaded.' : 'The document could not be exported.';
  } catch (error) {
    console.error('Could not export the document.', error);
    tableStatus.textContent = 'Could not export the document. Try again.';
  } finally {
    downloadButton.disabled = false;
  }
});

window.addEventListener('beforeunload', () => {
  stopAddRow?.();
  stopDeleteRow?.();
  removeHandlers?.();
  superdoc.destroy();
});
