import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

const saveButton = document.querySelector<HTMLButtonElement>('#save-version');
const exportButton = document.querySelector<HTMLButtonElement>('#export-docx');
const versionList = document.querySelector<HTMLOListElement>('#versions');
const status = document.querySelector<HTMLSpanElement>('#status');

if (!saveButton || !exportButton || !versionList || !status) {
  throw new Error('The version history controls are missing.');
}

const versions: Blob[] = [];
let busy = false;
let ready = false;

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  onReady: () => {
    ready = true;
    setBusy(busy);
    status.textContent = 'Document ready.';
  },
  onException: ({ error }) => {
    status.textContent = 'The document could not be opened.';
    console.error(error);
  },
});

const setBusy = (nextBusy: boolean) => {
  busy = nextBusy;
  saveButton.disabled = busy || !ready;
  exportButton.disabled = busy || !ready;
  for (const button of versionList.querySelectorAll('button')) button.disabled = busy || !ready;
};

const appendVersion = (docx: Blob) => {
  versions.push(docx);
  const index = versions.length - 1;
  const item = document.createElement('li');
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.textContent = `Restore version ${index + 1}`;
  restore.addEventListener('click', () => void restoreVersion(index));
  item.append(restore);
  versionList.append(item);
};

const restoreVersion = async (index: number) => {
  if (busy || !ready) return;
  setBusy(true);
  status.textContent = `Restoring version ${index + 1}...`;
  try {
    const result = await superdoc.replaceFile(versions[index]);
    const replacementResult = result && typeof result === 'object' ? result : null;
    const replacementState = replacementResult && 'state' in replacementResult ? replacementResult.state : null;
    const replacementSucceeded =
      replacementState === null || replacementState === 'review-ready' || replacementState === 'editing-ready';
    if (!replacementSucceeded) {
      throw new Error(`SuperDoc could not restore version ${index + 1}.`);
    }
    appendVersion(versions[index]);
    status.textContent = `Version ${index + 1} restored as version ${versions.length}.`;
  } catch (error) {
    status.textContent = `Version ${index + 1} could not be restored.`;
    console.error(error);
  } finally {
    setBusy(false);
  }
};

saveButton.addEventListener('click', async () => {
  if (busy || !ready) return;
  setBusy(true);
  status.textContent = 'Saving version...';
  try {
    const result = await superdoc.export({ exportType: ['docx'], triggerDownload: false });
    if (!(result instanceof Blob)) throw new Error('SuperDoc did not return a DOCX blob.');

    appendVersion(result);
    status.textContent = `Version ${versions.length} saved.`;
  } catch (error) {
    status.textContent = 'The version could not be saved.';
    console.error(error);
  } finally {
    setBusy(false);
  }
});

exportButton.addEventListener('click', async () => {
  if (busy || !ready) return;
  setBusy(true);
  try {
    await superdoc.export({ exportType: ['docx'], exportedName: 'restored-version' });
  } catch (error) {
    status.textContent = 'The DOCX could not be exported.';
    console.error(error);
  } finally {
    setBusy(false);
  }
});

window.addEventListener('beforeunload', () => superdoc.destroy());
