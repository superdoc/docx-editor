import { SuperDoc } from 'superdoc';
import type { UIConfig } from 'superdoc';
import type { CommandExecutionResult } from 'superdoc/ui';
import 'superdoc/style.css';

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing custom toolbar element: ${selector}`);
  return element;
}

const boldButton = getElement<HTMLButtonElement>('#bold');
const fontFamilySelect = getElement<HTMLSelectElement>('#font-family');
const fontSizeSelect = getElement<HTMLSelectElement>('#font-size');
const status = getElement<HTMLParagraphElement>('#formatting-status');

const editorUi = { toolbar: false } satisfies UIConfig;
let stopBindings: (() => void) | null = null;
let pending = false;

function syncOptions(
  select: HTMLSelectElement,
  options: readonly { value: string; label: string }[],
  selectedValue: unknown,
) {
  const selected = typeof selectedValue === 'string' || typeof selectedValue === 'number' ? String(selectedValue) : '';
  // `Mixed` describes a selection with no single value. It is not a command
  // payload, so it stays visible but cannot be chosen.
  const mixed = document.createElement('option');
  mixed.value = '';
  mixed.textContent = 'Mixed';
  mixed.disabled = true;
  // A uniform value outside the preset list is still one value. Keep it
  // selectable so the picker shows what the document has.
  const choices =
    selected && !options.some(({ value }) => value === selected)
      ? [{ value: selected, label: selected }, ...options]
      : options;
  select.replaceChildren(
    mixed,
    ...choices.map(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
  select.value = selected;
}

function report(result: CommandExecutionResult, message: string) {
  if (result === false) {
    status.textContent = 'The formatting action is unavailable.';
  } else if (typeof result === 'object' && !result.success) {
    status.textContent = result.failure.message;
  } else {
    status.textContent = message;
  }
}

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  ui: editorUi,
  onReady: ({ superdoc: readySuperDoc }) => {
    stopBindings?.();

    const { ui } = readySuperDoc;
    const bold = ui.commands.get('bold');
    const fontFamily = ui.commands.get('font-family');
    const fontSize = ui.commands.get('font-size');

    const render = () => {
      const fonts = ui.fonts.getSnapshot();
      const boldState = bold.getState();
      const familyState = fontFamily.getState();
      const sizeState = fontSize.getState();

      boldButton.disabled = pending || !boldState.enabled;
      boldButton.setAttribute('aria-pressed', String(boldState.active));
      syncOptions(fontFamilySelect, fonts.options, familyState.value);
      syncOptions(fontSizeSelect, fonts.sizeOptions, sizeState.value);
      fontFamilySelect.disabled = pending || !familyState.enabled;
      fontSizeSelect.disabled = pending || !sizeState.enabled;
    };

    // One action at a time. A second click before the first settles would
    // dispatch a second toggle, and overlapping picker changes could report
    // their results out of order.
    const run = async (action: () => Promise<CommandExecutionResult>, message: string) => {
      if (pending) return;
      pending = true;
      render();
      try {
        report(await action(), message);
      } finally {
        pending = false;
        render();
      }
    };

    const preserveSelection = (event: MouseEvent) => event.preventDefault();
    const toggleBold = () => run(() => bold.executeAsync(), bold.getState().active ? 'Bold removed.' : 'Bold applied.');
    // Read the chosen value before `run()` rerenders the select, which resets
    // it to the command's current value.
    const setFontFamily = () => {
      const value = fontFamilySelect.value;
      return run(() => fontFamily.executeAsync(value), 'Font updated.');
    };
    const setFontSize = () => {
      const value = fontSizeSelect.value;
      return run(() => fontSize.executeAsync(value), 'Font size updated.');
    };

    const stopObservers = [
      ui.fonts.observe(render),
      bold.observe(render),
      fontFamily.observe(render),
      fontSize.observe(render),
    ];

    boldButton.addEventListener('mousedown', preserveSelection);
    boldButton.addEventListener('click', toggleBold);
    fontFamilySelect.addEventListener('change', setFontFamily);
    fontSizeSelect.addEventListener('change', setFontSize);

    stopBindings = () => {
      for (const stop of stopObservers) stop();
      boldButton.removeEventListener('mousedown', preserveSelection);
      boldButton.removeEventListener('click', toggleBold);
      fontFamilySelect.removeEventListener('change', setFontFamily);
      fontSizeSelect.removeEventListener('change', setFontSize);
    };

    render();
    status.textContent = 'Select text to format it.';
  },
  onContentError: ({ error }) => {
    status.textContent = 'The document could not be opened.';
    console.error(error);
  },
  onException: ({ error }) => {
    status.textContent = 'The document could not be opened.';
    console.error(error);
  },
});

window.addEventListener('beforeunload', () => {
  stopBindings?.();
  superdoc.destroy();
});
