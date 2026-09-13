import { useState } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import type { UIConfig } from 'superdoc';
import type { CommandExecutionResult } from 'superdoc/ui';
import {
  SuperDocUIProvider,
  useSetSuperDoc,
  useSuperDocCommand,
  useSuperDocFontOptions,
  useSuperDocFontSizeOptions,
} from 'superdoc/ui/react';
import '@superdoc/react/style.css';

const editorUi = { toolbar: false } satisfies UIConfig;

type PickerOption = { value: string; label: string };

// A uniform value outside the preset list is still one value. Keep it
// selectable so the picker shows what the document has.
function getPickerChoices(options: readonly PickerOption[], commandValue: unknown): PickerOption[] {
  const selected = typeof commandValue === 'string' || typeof commandValue === 'number' ? String(commandValue) : '';
  if (!selected || options.some(({ value }) => value === selected)) return [...options];
  return [{ value: selected, label: selected }, ...options];
}

function getSelectedOptionValue(commandValue: unknown): string {
  return typeof commandValue === 'string' || typeof commandValue === 'number' ? String(commandValue) : '';
}

export default function App() {
  return (
    <SuperDocUIProvider>
      <FormattingToolbar />
      <Editor />
    </SuperDocUIProvider>
  );
}

function FormattingToolbar() {
  const bold = useSuperDocCommand('bold');
  const fontFamily = useSuperDocCommand('font-family');
  const fontSize = useSuperDocCommand('font-size');
  const fontOptions = useSuperDocFontOptions();
  const sizeOptions = useSuperDocFontSizeOptions();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('Select text to format it.');

  function report(result: CommandExecutionResult, message: string) {
    if (result === false) {
      setStatus('The formatting action is unavailable.');
    } else if (typeof result === 'object' && !result.success) {
      setStatus(result.failure.message);
    } else {
      setStatus(message);
    }
  }

  // One action at a time. A second click before the first settles would
  // dispatch a second toggle, and overlapping picker changes could report
  // their results out of order.
  async function run(action: () => Promise<CommandExecutionResult>, message: string) {
    if (pending) return;
    setPending(true);
    try {
      report(await action(), message);
    } finally {
      setPending(false);
    }
  }

  const familyValue = getSelectedOptionValue(fontFamily.value);
  const sizeValue = getSelectedOptionValue(fontSize.value);
  const familyChoices = getPickerChoices(fontOptions, fontFamily.value);
  const sizeChoices = getPickerChoices(sizeOptions, fontSize.value);

  return (
    <>
      <div aria-label='Formatting controls' role='toolbar'>
        <button
          aria-pressed={bold.active}
          disabled={pending || !bold.enabled}
          onClick={() => void run(() => bold.executeAsync(), bold.active ? 'Bold removed.' : 'Bold applied.')}
          onMouseDown={(event) => event.preventDefault()}
          type='button'
        >
          Bold
        </button>
        <label>
          Font
          <select
            disabled={pending || !fontFamily.enabled}
            onChange={(event) => void run(() => fontFamily.executeAsync(event.target.value), 'Font updated.')}
            value={familyValue}
          >
            <option disabled value=''>
              Mixed
            </option>
            {familyChoices.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Size
          <select
            disabled={pending || !fontSize.enabled}
            onChange={(event) => void run(() => fontSize.executeAsync(event.target.value), 'Font size updated.')}
            value={sizeValue}
          >
            <option disabled value=''>
              Mixed
            </option>
            {sizeChoices.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <output aria-live='polite' role='status'>
        {status}
      </output>
    </>
  );
}

function Editor() {
  const setSuperDoc = useSetSuperDoc();

  return (
    <SuperDocEditor
      document='/sample.docx'
      onContentError={({ error }) => console.error('SuperDoc could not open the document.', error)}
      onException={({ error }) => console.error('SuperDoc could not open the document.', error)}
      onReady={({ superdoc }) => setSuperDoc(superdoc)}
      ui={editorUi}
    />
  );
}
