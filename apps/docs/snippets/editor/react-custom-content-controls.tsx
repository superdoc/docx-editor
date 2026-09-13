import { useEffect, useRef, useState } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import type { ContentControlInfo, ContentControlsSlice } from 'superdoc/ui';
import { SuperDocUIProvider, useSetSuperDoc, useSuperDocHost, useSuperDocUI } from 'superdoc/ui/react';
import '@superdoc/react/style.css';

type PendingMutation =
  | { checked: boolean; controlId: string; controlName: string; kind: 'checkbox' }
  | { controlId: string; controlName: string; kind: 'text'; value: string };

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

export default function App() {
  return (
    <SuperDocUIProvider>
      <main className='fields-layout'>
        <Editor />
        <FieldPanel />
      </main>
    </SuperDocUIProvider>
  );
}

function Editor() {
  const setSuperDoc = useSetSuperDoc();

  return (
    <SuperDocEditor
      document='/contract.docx'
      onContentError={({ error }) => console.error('SuperDoc could not open the document.', error)}
      onException={({ error }) => console.error('SuperDoc could not open the document.', error)}
      onReady={({ superdoc }) => setSuperDoc(superdoc)}
    />
  );
}

function FieldPanel() {
  const host = useSuperDocHost();
  const ui = useSuperDocUI();
  const [fields, setFields] = useState<ContentControlsSlice>({
    status: 'pending',
    items: [],
    total: 0,
    activeId: null,
    activeIds: [],
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const [status, setStatus] = useState('Choose a field to edit it.');
  const catalogRequest = useRef(0);
  const mutationInFlight = useRef(false);

  async function readFields(snapshot: ContentControlsSlice, failureMessage = 'The field list could not be refreshed.') {
    const request = ++catalogRequest.current;
    try {
      const catalog = await host?.activeEditor?.doc?.contentControls?.list?.();
      if (!catalog) throw new Error('Field catalog unavailable.');
      if (request !== catalogRequest.current) return;
      setFields({ ...snapshot, status: 'ready', items: catalog.items, total: catalog.total });
    } catch {
      if (request !== catalogRequest.current) return;
      if (mutationInFlight.current) return;
      setPendingMutation(null);
      setStatus(failureMessage);
    }
  }

  useEffect(() => {
    if (!ui) return;
    const stop = ui.contentControls.observe((snapshot) => {
      void readFields(snapshot);
    });
    return () => {
      catalogRequest.current += 1;
      stop();
    };
  }, [ui, host]);

  async function refreshFields() {
    if (!ui) {
      setPendingMutation(null);
      setStatus('Editor unavailable.');
      return;
    }
    await readFields(
      ui.contentControls.getSnapshot(),
      'The document changed, but the field list could not be refreshed.',
    );
  }

  useEffect(() => {
    if (!pendingMutation || mutationInFlight.current) return;
    const updatedField = fields.items.find((field) => mutationIsObserved(field, pendingMutation));
    if (!updatedField) return;

    if (pendingMutation.kind === 'text') {
      setDrafts((current) => {
        const next = { ...current };
        delete next[pendingMutation.controlId];
        return next;
      });
    }
    setStatus(
      pendingMutation.kind === 'checkbox'
        ? `${pendingMutation.controlName} ${pendingMutation.checked ? 'checked' : 'unchecked'}.`
        : `${pendingMutation.controlName} updated.`,
    );
    setPendingMutation(null);
  }, [fields.items, pendingMutation]);

  async function showField(control: ContentControlInfo) {
    if (!ui || pendingMutation) return;
    const name = fieldName(control);
    const result = await ui.contentControls.focus({ id: control.id });
    setStatus(result.success ? `Showing ${name} in the document.` : `${name} could not be shown in the document.`);
  }

  async function updateTextField(control: ContentControlInfo, value: string) {
    if (pendingMutation || mutationInFlight.current) return;
    const documentApi = host?.activeEditor?.doc;
    if (!documentApi?.contentControls?.text?.setValue) {
      setStatus('Text field editing is unavailable.');
      return;
    }

    const name = fieldName(control);
    const mutation: PendingMutation = { controlId: control.id, controlName: name, kind: 'text', value };
    mutationInFlight.current = true;
    catalogRequest.current += 1;
    setPendingMutation(mutation);
    setStatus(`Updating ${name}…`);
    try {
      const receipt = await documentApi.contentControls.text.setValue({ target: control.target, value });
      mutationInFlight.current = false;
      if (!receipt.success) {
        setPendingMutation(null);
        setStatus(receipt.failure.message);
      } else await refreshFields();
    } catch (error) {
      mutationInFlight.current = false;
      setPendingMutation(null);
      setStatus(error instanceof Error ? error.message : `${name} could not be updated.`);
    }
  }

  async function updateCheckbox(control: ContentControlInfo, checked: boolean) {
    if (pendingMutation || mutationInFlight.current) return;
    const documentApi = host?.activeEditor?.doc;
    if (!documentApi?.contentControls?.checkbox?.setState) {
      setStatus('Checkbox editing is unavailable.');
      return;
    }

    const name = fieldName(control);
    const mutation: PendingMutation = { checked, controlId: control.id, controlName: name, kind: 'checkbox' };
    mutationInFlight.current = true;
    catalogRequest.current += 1;
    setPendingMutation(mutation);
    setStatus(`Updating ${name}…`);
    try {
      const receipt = await documentApi.contentControls.checkbox.setState({ target: control.target, checked });
      mutationInFlight.current = false;
      if (!receipt.success) {
        setPendingMutation(null);
        setStatus(receipt.failure.message);
      } else await refreshFields();
    } catch (error) {
      mutationInFlight.current = false;
      setPendingMutation(null);
      setStatus(error instanceof Error ? error.message : `${name} could not be updated.`);
    }
  }

  return (
    <aside aria-labelledby='fields-heading'>
      <h2 id='fields-heading'>Document fields</h2>
      <p>{fields.status === 'pending' ? 'Loading fields…' : `${fields.total} document fields`}</p>

      <ul>
        {fields.items.map((field) => {
          const name = fieldName(field);
          const locked = isContentLocked(field);
          const draft = drafts[field.id] ?? field.text ?? '';
          const checked =
            pendingMutation?.kind === 'checkbox' && pendingMutation.controlId === field.id
              ? pendingMutation.checked
              : (field.properties.checked ?? false);

          return (
            <li aria-current={fields.activeIds.includes(field.id) ? 'true' : undefined} key={field.id}>
              <strong>{name}</strong>
              <button disabled={pendingMutation !== null} onClick={() => void showField(field)} type='button'>
                {fields.activeIds.includes(field.id) ? 'Showing' : 'Show in document'}
              </button>

              {field.controlType === 'text' && (
                <>
                  <input
                    aria-label={`Value for ${name}`}
                    disabled={locked || pendingMutation !== null}
                    onChange={(event) => setDrafts((current) => ({ ...current, [field.id]: event.target.value }))}
                    type='text'
                    value={draft}
                  />
                  <button
                    disabled={locked || pendingMutation !== null || draft === (field.text ?? '')}
                    onClick={() => void updateTextField(field, draft)}
                    type='button'
                  >
                    {pendingMutation?.kind === 'text' && pendingMutation.controlId === field.id
                      ? 'Updating…'
                      : 'Update'}
                  </button>
                </>
              )}

              {field.controlType === 'checkbox' && (
                <label>
                  <input
                    checked={checked}
                    disabled={locked || pendingMutation !== null}
                    onChange={(event) => void updateCheckbox(field, event.target.checked)}
                    type='checkbox'
                  />
                  Approved
                </label>
              )}
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
