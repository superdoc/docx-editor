import { SuperDoc } from 'superdoc';
import type { UIConfig } from 'superdoc';
import 'superdoc/style.css';

const boldButton = document.querySelector<HTMLButtonElement>('#bold');
const status = document.querySelector<HTMLOutputElement>('#status');
if (!boldButton || !status) throw new Error('The custom controls are missing.');

let stopObserving: (() => void) | null = null;
let removeHandlers: (() => void) | null = null;

const editorUi = {
  toolbar: {
    container: '#toolbar',
    excludeItems: ['bold'],
  },
} satisfies UIConfig;

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  ui: editorUi,
  onReady: ({ superdoc: readySuperDoc }) => {
    stopObserving?.();
    removeHandlers?.();
    const bold = readySuperDoc.ui.commands.get('bold');

    let pending = false;
    const render = (state: ReturnType<typeof bold.getState>) => {
      boldButton.disabled = pending || !state.enabled;
      boldButton.setAttribute('aria-pressed', String(state.active));
      boldButton.title = state.reason ?? 'Toggle bold';
    };

    const onBoldClick = async () => {
      if (pending) return;
      const message = bold.getState().active ? 'Bold removed.' : 'Bold applied.';
      pending = true;
      render(bold.getState());
      try {
        const result = await bold.executeAsync();
        const applied = result === true || (typeof result === 'object' && result.success);
        status.textContent = applied ? message : 'Bold was not changed.';
      } finally {
        pending = false;
        render(bold.getState());
      }
    };

    const preserveSelection = (event: MouseEvent) => event.preventDefault();
    render(bold.getState());
    stopObserving = bold.observe(render);
    boldButton.addEventListener('mousedown', preserveSelection);
    boldButton.addEventListener('click', onBoldClick);
    removeHandlers = () => {
      boldButton.removeEventListener('mousedown', preserveSelection);
      boldButton.removeEventListener('click', onBoldClick);
    };
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
  stopObserving?.();
  removeHandlers?.();
  superdoc.destroy();
});
