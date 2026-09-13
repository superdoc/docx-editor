import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import { renderParticipants } from './participants';
import { demoCredentials } from './demo-credentials';

const exportButton = document.querySelector<HTMLButtonElement>('#export-docx');
const status = document.querySelector<HTMLSpanElement>('#status');
if (!exportButton || !status) throw new Error('The collaboration controls are missing.');

const response = await fetch('/sample.docx');
if (!response.ok) throw new Error(`The sample document returned ${response.status}.`);

const params = new URLSearchParams(window.location.search);
const roomMode = params.get('mode') === 'create' ? 'create' : 'join';
const userName = params.get('user') ?? 'Browser user';
const collaborationPort = 1234 + Number(import.meta.env.VITE_SUPERDOC_EXAMPLE_PORT_OFFSET ?? '0');

const superdoc = new SuperDoc({
  selector: '#editor',
  documents: [
    {
      id: 'shared-document',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: await response.blob(),
      v2Collaboration: {
        providerType: 'hocuspocus',
        documentId: 'example-room',
        serverUrl: `ws://127.0.0.1:${collaborationPort}`,
        roomMode,
        token: import.meta.env.VITE_COLLABORATION_DEMO_AUTH === '1' ? demoCredentials[userName] : undefined,
      },
    },
  ],
  user: { name: userName, email: `${userName.toLowerCase().replaceAll(' ', '-')}@example.com` },
  onAwarenessUpdate: renderParticipants,
  onCollaborationReady: () => {
    exportButton.disabled = false;
    status.textContent = 'Connected.';
  },
  onException: (payload) => {
    // SuperDoc Diagnostics MVP: a structured diagnostic payload is emitted
    // in addition to (and sometimes instead of) a real connection failure --
    // it can also fire on its own for non-fatal mid-session issues (e.g. a
    // render-readiness hiccup during a remote collaboration change) that
    // never affected the connection. Narrow it out before treating every
    // exception as "Connection failed."
    if ('diagnosticCode' in payload) {
      console.warn('[SuperDoc diagnostic]', payload.diagnosticCode, payload.message);
      return;
    }
    status.textContent = 'Connection failed.';
    console.error(payload.error);
  },
});

exportButton.addEventListener('click', async () => {
  exportButton.disabled = true;
  try {
    await superdoc.export({ exportType: ['docx'], exportedName: 'collaborative-document' });
  } finally {
    exportButton.disabled = false;
  }
});

window.addEventListener('beforeunload', () => superdoc.destroy());
