import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

const shell = document.querySelector<HTMLElement>('#editor-shell');
const fullscreen = document.querySelector<HTMLButtonElement>('#fullscreen');
const status = document.querySelector<HTMLElement>('#layout-status');

if (!shell || !fullscreen || !status) throw new Error('The responsive editor shell is incomplete.');
let ready = false;

const showError = ({ error }: { error: unknown }) => {
  console.error('Could not open the document.', error);
  status.textContent = 'Could not open the document. Reload to retry.';
};

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  contained: true,
  onContentError: showError,
  onException: showError,
  onReady: () => {
    ready = true;
    fullscreen.disabled = !document.fullscreenEnabled;
    status.textContent = document.fullscreenEnabled ? '' : 'Fullscreen is unavailable in this browser.';
  },
  zoom: {
    mode: 'fit-width',
    fitWidth: { min: 40, max: 100, padding: 24 },
  },
  ui: {
    toolbar: {
      container: '#toolbar',
      responsiveTo: 'container',
    },
    comments: { layout: 'auto' },
  },
});

const toggleFullscreen = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await shell.requestFullscreen();
    status.textContent = '';
  } catch (error) {
    console.error('Could not change fullscreen mode.', error);
    status.textContent = 'Could not change fullscreen mode. You can keep editing here.';
  }
};
const refit = () => {
  fullscreen.textContent = document.fullscreenElement === shell ? 'Exit fullscreen' : 'Fullscreen';
  if (ready) superdoc.setZoomMode('fit-width');
};

fullscreen.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', refit);

window.addEventListener('beforeunload', () => {
  fullscreen.removeEventListener('click', toggleFullscreen);
  document.removeEventListener('fullscreenchange', refit);
  superdoc.destroy();
});
