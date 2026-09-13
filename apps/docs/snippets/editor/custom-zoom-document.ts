import { SuperDoc } from 'superdoc';
import type { UIConfig } from 'superdoc';
import type { DocumentSlice } from 'superdoc/ui';
import 'superdoc/style.css';

const zoomOut = document.querySelector<HTMLButtonElement>('#zoom-out');
const zoomIn = document.querySelector<HTMLButtonElement>('#zoom-in');
const exportButton = document.querySelector<HTMLButtonElement>('#export');
const status = document.querySelector<HTMLOutputElement>('#document-status');
const errorMessage = document.querySelector<HTMLParagraphElement>('#document-error');

if (!zoomOut || !zoomIn || !exportButton || !status || !errorMessage) {
  throw new Error('The document controls are incomplete.');
}

let stopObservers: Array<() => void> = [];
let removeHandlers: (() => void) | null = null;
let actionMessage = '';
let exportInFlight = false;

function modeLabel(mode: DocumentSlice['mode']) {
  if (mode === 'editing') return 'Editing';
  if (mode === 'suggesting') return 'Suggesting';
  if (mode === 'viewing') return 'Viewing';
  return 'Ready';
}

const editorUi = {
  toolbar: {
    container: '#toolbar',
    excludeItems: ['zoom'],
  },
} satisfies UIConfig;

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  ui: editorUi,
  onReady: ({ superdoc: readySuperDoc }) => {
    for (const stop of stopObservers) stop();
    removeHandlers?.();
    actionMessage = '';
    exportInFlight = false;
    errorMessage.textContent = '';

    const ui = readySuperDoc.ui;

    const render = () => {
      const zoom = ui.zoom.getSnapshot();
      const currentDocument = ui.document.getSnapshot();
      zoomOut.disabled = zoom.value <= zoom.min;
      zoomIn.disabled = zoom.value >= zoom.max;
      exportButton.disabled = !currentDocument.ready || exportInFlight;
      status.value = currentDocument.ready
        ? `${modeLabel(currentDocument.mode)} · ${zoom.value}%${actionMessage ? ` · ${actionMessage}` : ''}`
        : 'Loading the document…';
    };

    const changeZoom = (delta: number) => {
      const zoom = ui.zoom.getSnapshot();
      ui.zoom.set(Math.min(zoom.max, Math.max(zoom.min, zoom.value + delta)));
    };
    const zoomOutHandler = () => changeZoom(-10);
    const zoomInHandler = () => changeZoom(10);
    const exportHandler = async () => {
      if (exportInFlight) return;

      exportInFlight = true;
      actionMessage = 'Preparing the DOCX…';
      render();
      try {
        const pendingExport = ui.document.export({ exportType: ['docx'], triggerDownload: true });
        if (!pendingExport) {
          actionMessage = 'Export is unavailable in this host.';
          return;
        }
        await pendingExport;
        actionMessage = 'DOCX downloaded.';
      } catch (error) {
        actionMessage = error instanceof Error ? error.message : 'The DOCX could not be exported.';
      } finally {
        exportInFlight = false;
        render();
      }
    };

    stopObservers = [ui.zoom.observe(render), ui.document.observe(render)];
    zoomOut.addEventListener('click', zoomOutHandler);
    zoomIn.addEventListener('click', zoomInHandler);
    exportButton.addEventListener('click', exportHandler);

    removeHandlers = () => {
      zoomOut.removeEventListener('click', zoomOutHandler);
      zoomIn.removeEventListener('click', zoomInHandler);
      exportButton.removeEventListener('click', exportHandler);
    };
  },
  onContentError: ({ error }) => {
    errorMessage.textContent = 'The document could not be read or updated.';
    console.error(error);
  },
  onException: ({ error }) => {
    errorMessage.textContent = 'The editor reported a runtime error.';
    console.error(error);
  },
});

window.addEventListener('beforeunload', () => {
  for (const stop of stopObservers) stop();
  removeHandlers?.();
  superdoc.destroy();
});
