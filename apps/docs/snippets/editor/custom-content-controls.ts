import { SuperDoc } from 'superdoc';
import type { ContentControlInfo, ContentControlsSlice } from 'superdoc/ui';
import 'superdoc/style.css';

type PendingMutation =
  | { checked: boolean; controlId: string; controlName: string; kind: 'checkbox' }
  | { controlId: string; controlName: string; kind: 'text'; value: string };

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing field panel element: ${selector}`);
  return element;
}

function fieldName(control: ContentControlInfo) {
  return control.properties.alias ?? control.properties.tag ?? control.controlType;
}

function isContentLocked(control: ContentControlInfo) {
  return control.lockMode === 'contentLocked' || control.lockMode === 'sdtContentLocked';
}

function mutationIsObserved(control: ContentControlInfo, mutation: PendingMutation) {
  if (control.id !== mutation.controlId) return false;
  if (mutation.kind === 'checkbox') return control.properties.checked === mutation.checked;
  return control.text === mutation.value;
}

const fieldCount = getElement<HTMLParagraphElement>('#fields-count');
const fieldList = getElement<HTMLUListElement>('#field-list');
const fieldsStatus = getElement<HTMLParagraphElement>('#fields-status');

const drafts = new Map<string, string>();
let pendingMutation: PendingMutation | null = null;
let stopContentControls: (() => void) | null = null;

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/contract.docx',
  onReady: ({ superdoc: readySuperDoc }) => {
    stopContentControls?.();
    const documentApi = readySuperDoc.activeEditor?.doc;
    if (!documentApi) throw new Error('The Document API is not ready.');

    const { ui } = readySuperDoc;

    const showField = async (control: ContentControlInfo) => {
      if (pendingMutation) return;
      const name = fieldName(control);
      const result = await ui.contentControls.focus({ id: control.id });
      fieldsStatus.textContent = result.success
        ? `Showing ${name} in the document.`
        : `${name} could not be shown in the document.`;
    };

    // Rerender from the last observed snapshot so pending state changes are
    // reflected without an extra catalog read.
    let lastControls: ContentControlsSlice | null = null;
    let mutationInFlight = false;

    const failMutation = (message: string) => {
      pendingMutation = null;
      fieldsStatus.textContent = message;
      if (lastControls) render(lastControls);
    };

    let catalogRequest = 0;
    const readFields = async (
      snapshot: ContentControlsSlice,
      failureMessage = 'The field list could not be refreshed.',
    ) => {
      const request = ++catalogRequest;
      try {
        const catalog = await documentApi.contentControls.list();
        if (request !== catalogRequest) return;
        render({ ...snapshot, status: 'ready', items: catalog.items, total: catalog.total });
      } catch {
        if (request !== catalogRequest) return;
        if (!mutationInFlight) failMutation(failureMessage);
      }
    };

    const refreshFields = async () => {
      await readFields(
        ui.contentControls.getSnapshot(),
        'The document changed, but the field list could not be refreshed.',
      );
    };

    const updateTextField = async (control: ContentControlInfo, value: string) => {
      if (pendingMutation) return;
      mutationInFlight = true;
      catalogRequest += 1;
      const name = fieldName(control);
      // Keep the submitted value as the draft so a failed update does not
      // reset the input to the document's old text.
      drafts.set(control.id, value);
      pendingMutation = { controlId: control.id, controlName: name, kind: 'text', value };
      fieldsStatus.textContent = `Updating ${name}…`;
      if (lastControls) render(lastControls);

      try {
        const receipt = await documentApi.contentControls.text.setValue({ target: control.target, value });
        mutationInFlight = false;
        if (!receipt.success) failMutation(receipt.failure.message);
        else await refreshFields();
      } catch (error) {
        mutationInFlight = false;
        failMutation(error instanceof Error ? error.message : `${name} could not be updated.`);
      }
    };

    const updateCheckbox = async (control: ContentControlInfo, checked: boolean) => {
      if (pendingMutation) return;
      mutationInFlight = true;
      catalogRequest += 1;
      const name = fieldName(control);
      pendingMutation = { checked, controlId: control.id, controlName: name, kind: 'checkbox' };
      fieldsStatus.textContent = `Updating ${name}…`;
      if (lastControls) render(lastControls);

      try {
        const receipt = await documentApi.contentControls.checkbox.setState({ target: control.target, checked });
        mutationInFlight = false;
        if (!receipt.success) failMutation(receipt.failure.message);
        else await refreshFields();
      } catch (error) {
        mutationInFlight = false;
        failMutation(error instanceof Error ? error.message : `${name} could not be updated.`);
      }
    };

    const render = (controls: ContentControlsSlice) => {
      lastControls = controls;
      const currentMutation = pendingMutation;
      const observedMutation =
        currentMutation && controls.items.find((control) => mutationIsObserved(control, currentMutation));
      if (currentMutation && observedMutation && !mutationInFlight) {
        const completedMutation = currentMutation;
        pendingMutation = null;
        if (completedMutation.kind === 'text') drafts.delete(completedMutation.controlId);
        fieldsStatus.textContent =
          completedMutation.kind === 'checkbox'
            ? `${completedMutation.controlName} ${completedMutation.checked ? 'checked' : 'unchecked'}.`
            : `${completedMutation.controlName} updated.`;
      }

      fieldCount.textContent = controls.status === 'pending' ? 'Loading fields…' : `${controls.total} document fields`;
      fieldList.replaceChildren();

      for (const control of controls.items) {
        const row = document.createElement('li');
        const label = document.createElement('strong');
        const show = document.createElement('button');
        const name = fieldName(control);
        const locked = isContentLocked(control);

        label.textContent = name;
        show.type = 'button';
        show.textContent = controls.activeIds.includes(control.id) ? 'Showing' : 'Show in document';
        show.disabled = pendingMutation !== null;
        show.addEventListener('click', () => void showField(control));
        row.append(label, show);

        if (control.controlType === 'text') {
          const input = document.createElement('input');
          const update = document.createElement('button');
          const currentValue = control.text ?? '';

          input.type = 'text';
          input.value = drafts.get(control.id) ?? currentValue;
          input.disabled = locked || pendingMutation !== null;
          input.setAttribute('aria-label', `Value for ${name}`);
          input.addEventListener('input', () => {
            drafts.set(control.id, input.value);
            update.disabled = locked || pendingMutation !== null || input.value === currentValue;
          });
          update.type = 'button';
          update.textContent = pendingMutation?.controlId === control.id ? 'Updating…' : 'Update';
          update.disabled = locked || pendingMutation !== null || input.value === currentValue;
          update.addEventListener('click', () => void updateTextField(control, input.value));
          row.append(input, update);
        }

        if (control.controlType === 'checkbox') {
          const checkboxLabel = document.createElement('label');
          const checkbox = document.createElement('input');

          checkbox.type = 'checkbox';
          checkbox.checked =
            pendingMutation?.kind === 'checkbox' && pendingMutation.controlId === control.id
              ? pendingMutation.checked
              : (control.properties.checked ?? false);
          checkbox.disabled = locked || pendingMutation !== null;
          checkbox.addEventListener('change', () => void updateCheckbox(control, checkbox.checked));
          checkboxLabel.append(checkbox, ' Approved');
          row.append(checkboxLabel);
        }

        fieldList.append(row);
      }
    };

    const stop = ui.contentControls.observe((snapshot) => {
      void readFields(snapshot);
    });
    stopContentControls = () => {
      catalogRequest += 1;
      stop();
    };
  },
  onContentError: ({ error }) => {
    fieldsStatus.textContent = 'The document could not be opened.';
    console.error(error);
  },
  onException: ({ error }) => {
    fieldsStatus.textContent = 'The document could not be opened.';
    console.error(error);
  },
});

window.addEventListener('beforeunload', () => {
  stopContentControls?.();
  superdoc.destroy();
});
