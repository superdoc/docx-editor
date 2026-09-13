import { SuperDoc } from 'superdoc';
import type { BrowserDocumentApi, ContentControlInfo } from 'superdoc/ui';
import { hasCompatibleTemplateFields, templateFields, type TemplateFieldKey } from './field-schema';
import { createSerialTaskQueue } from './serial-task-queue';
import { describeUpdate, didUpdateEveryMatch, updateCheckboxField, updateTextField } from './template-fields';

const status = requireElement<HTMLParagraphElement>('#filling-status');
const exportButton = requireElement<HTMLButtonElement>('#export-filled-docx');
const lockAddress = requireElement<HTMLInputElement>('#lock-address');
const formInputs = {
  autoRenew: requireElement<HTMLInputElement>('#auto-renew'),
  clientAddress: requireElement<HTMLInputElement>('#client-address'),
  clientLegalName: requireElement<HTMLInputElement>('#client-legal-name'),
  effectiveDate: requireElement<HTMLInputElement>('#effective-date'),
};
const textInputFields = templateFields.filter((field) => field.type === 'text');

let documentApi: BrowserDocumentApi | null = null;
let controls: ContentControlInfo[] = [];
let controlsCleanup: (() => void) | null = null;
let hydrated = false;
let exporting = false;
let locking = false;
let controlsReadSequence = 0;
let controlsReadFailed = false;
let clientNameIndex = 0;
let updateSequence = 0;
let updateQueue = Promise.resolve();
const failedFields = new Set<TemplateFieldKey>();
const compatibleFields = new Set<TemplateFieldKey>();
const inputTimers = new Map<TemplateFieldKey, number>();

function requireElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}.`);
  return element;
}

function controlsForTag(tag: string) {
  return controls.filter((control) => control.properties.tag === tag);
}

function setActiveField(key: TemplateFieldKey | null) {
  document.querySelectorAll<HTMLElement>('[data-field]').forEach((row) => {
    row.dataset.active = String(row.dataset.field === key);
  });
}

function updateClientNamePosition() {
  const occurrences = controlsForTag('client.legalName');
  const navigation = requireElement<HTMLElement>('.occurrence-nav');
  navigation.hidden = occurrences.length < 2;
  requireElement<HTMLSpanElement>('#client-name-position').textContent = occurrences.length
    ? `${clientNameIndex + 1} / ${occurrences.length}`
    : '';
}

function recordUpdate(key: TemplateFieldKey, result: { failures: readonly string[]; matched: number }) {
  if (!didUpdateEveryMatch(result)) failedFields.add(key);
  else failedFields.delete(key);
}

function hydrateForm(items: readonly ContentControlInfo[]) {
  const wasHydrated = hydrated;
  for (const field of templateFields) {
    const control = items.find((item) => item.properties.tag === field.tag && item.controlType === field.type);
    const input = formInputs[field.key];
    if (control) {
      if (!compatibleFields.has(field.key)) {
        if (field.type === 'checkbox') input.checked = control.properties.checked ?? false;
        else input.value = control.text ?? '';
      }
      compatibleFields.add(field.key);
    } else {
      compatibleFields.delete(field.key);
    }
    const lockMode = control?.lockMode;
    input.disabled =
      exporting ||
      locking ||
      controlsReadFailed ||
      !control ||
      lockMode === 'contentLocked' ||
      lockMode === 'sdtContentLocked';
  }

  hydrated = hasCompatibleTemplateFields(items);
  exportButton.disabled = exporting || locking || !hydrated;
  const address = items.find((item) => item.properties.tag === 'client.address');
  lockAddress.disabled = exporting || locking || controlsReadFailed || !address;
  if (!locking && !controlsReadFailed) {
    lockAddress.checked = address?.lockMode === 'contentLocked' || address?.lockMode === 'sdtContentLocked';
  }
  if (hydrated !== wasHydrated || !hydrated) {
    status.textContent = hydrated ? 'Template ready.' : 'Template fields are missing or incompatible.';
  }
}

async function refreshControls() {
  if (!documentApi) return;
  const sequence = ++controlsReadSequence;
  try {
    const { items } = await documentApi.contentControls.list();
    if (sequence === controlsReadSequence) {
      controlsReadFailed = false;
      controls = [...items];
      hydrateForm(items);
      updateClientNamePosition();
    }
  } catch (error) {
    if (sequence === controlsReadSequence) {
      controlsReadFailed = true;
      hydrateForm(controls);
    }
    throw error;
  }
}

function connectControls(superdoc: SuperDoc) {
  const handle = superdoc.ui.contentControls;
  controlsCleanup = handle.observe((snapshot) => {
    if (locking || snapshot.status !== 'ready') return;
    void refreshControls().catch(() => {
      status.textContent = 'The template fields could not be read.';
    });
  });
  handle.list();
}

async function applyTextField(field: (typeof textInputFields)[number]) {
  if (!documentApi) return;
  const sequence = ++updateSequence;
  status.textContent = 'Updating document...';
  try {
    const result = await updateTextField(documentApi, field.tag, formInputs[field.key].value);
    recordUpdate(field.key, result);
    if (sequence === updateSequence) status.textContent = describeUpdate(result);
  } catch (error) {
    failedFields.add(field.key);
    if (sequence === updateSequence) status.textContent = 'The document could not be updated.';
    throw error;
  }
}

function queueUpdate(update: () => Promise<void>) {
  const pending = updateQueue.then(update);
  updateQueue = pending.catch(() => undefined);
  return pending;
}

function scheduleTextField(field: (typeof textInputFields)[number]) {
  const currentTimer = inputTimers.get(field.key);
  if (currentTimer) window.clearTimeout(currentTimer);
  inputTimers.set(
    field.key,
    window.setTimeout(() => {
      inputTimers.delete(field.key);
      void queueUpdate(() => applyTextField(field));
    }, 250),
  );
}

function flushTextUpdates() {
  for (const field of textInputFields) {
    const timer = inputTimers.get(field.key);
    if (!timer) continue;
    window.clearTimeout(timer);
    inputTimers.delete(field.key);
    void queueUpdate(() => applyTextField(field));
  }
}

async function focusClientName(direction: -1 | 1) {
  const occurrences = controlsForTag('client.legalName');
  if (occurrences.length === 0) return;
  clientNameIndex = (clientNameIndex + direction + occurrences.length) % occurrences.length;
  updateClientNamePosition();
  setActiveField('clientLegalName');
  try {
    const result = await superdoc.ui.contentControls.focus({ id: occurrences[clientNameIndex].id });
    status.textContent = result.success
      ? `Focused client name ${clientNameIndex + 1} of ${occurrences.length}.`
      : 'Could not focus that occurrence.';
  } catch {
    status.textContent = 'Could not focus that occurrence.';
  }
}

const queueClientNameFocus = createSerialTaskQueue(focusClientName);

for (const field of textInputFields) {
  formInputs[field.key].addEventListener('input', () => scheduleTextField(field));
}

formInputs.autoRenew.addEventListener('change', () => {
  if (!documentApi) return;
  void queueUpdate(async () => {
    if (!documentApi) return;
    status.textContent = 'Updating document...';
    try {
      const result = await updateCheckboxField(documentApi, 'agreement.autoRenew', formInputs.autoRenew.checked);
      recordUpdate('autoRenew', result);
      status.textContent = describeUpdate(result);
    } catch (error) {
      failedFields.add('autoRenew');
      status.textContent = 'The document could not be updated.';
      throw error;
    }
  });
});

requireElement<HTMLButtonElement>('#previous-client-name').addEventListener(
  'click',
  () => void queueClientNameFocus(-1),
);
requireElement<HTMLButtonElement>('#next-client-name').addEventListener('click', () => void queueClientNameFocus(1));
requireElement<HTMLButtonElement>('#reset-template').addEventListener('click', () => window.location.reload());

lockAddress.addEventListener('change', async () => {
  if (!documentApi || locking || exporting) return;
  const shouldLock = lockAddress.checked;
  locking = true;
  controlsReadSequence += 1;
  hydrateForm(controls);
  try {
    flushTextUpdates();
    await updateQueue;
    if (failedFields.size > 0) throw new Error('Fix failed field updates before locking.');
    const { items } = await documentApi.contentControls.selectByTag({ tag: 'client.address' });
    if (items.length !== 1) throw new Error('Expected one client address field.');
    const receipt = await documentApi.contentControls.setLockMode({
      target: items[0].target,
      lockMode: shouldLock ? 'contentLocked' : 'unlocked',
    });
    if (!receipt.success) throw new Error(receipt.failure.message);
    await refreshControls();
    status.textContent = shouldLock ? 'Client address locked.' : 'Client address unlocked.';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'The address lock could not be changed.';
  } finally {
    locking = false;
    hydrateForm(controls);
  }
});

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/service-agreement-template.docx',
  ui: {
    comments: false,
    toolbar: false,
  },
  onReady: ({ superdoc: readySuperDoc }) => {
    documentApi = readySuperDoc.activeEditor?.doc ?? null;
    if (!documentApi) {
      status.textContent = 'The Document API is not ready.';
      return;
    }
    connectControls(readySuperDoc);
  },
  onException: ({ error }) => {
    status.textContent = 'The template could not be opened.';
    console.error(error);
  },
});

exportButton.addEventListener('click', async () => {
  if (exporting || locking) return;
  exporting = true;
  lockAddress.disabled = true;
  exportButton.disabled = true;
  for (const input of Object.values(formInputs)) input.disabled = true;
  try {
    flushTextUpdates();
    await updateQueue;
    if (failedFields.size > 0) {
      status.textContent = 'Fix failed field updates before exporting.';
      return;
    }
    await superdoc.export({ exportType: ['docx'], exportedName: 'service-agreement' });
  } catch {
    status.textContent = 'The filled DOCX could not be exported.';
  } finally {
    exporting = false;
    hydrateForm(controls);
  }
});

window.addEventListener('beforeunload', () => {
  for (const timer of inputTimers.values()) window.clearTimeout(timer);
  controlsCleanup?.();
  superdoc.destroy();
});
