import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import { ApiError, DOCUMENT_ID, api, type VersionRecord } from './api.ts';

declare global {
  interface Window {
    versionHistoryExample: { superdoc: SuperDoc; refresh(): Promise<void> };
  }
}

const element = <T extends HTMLElement>(id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The page is missing #${id}.`);
  return found as T;
};

const userLabel = element<HTMLSpanElement>('user');
const connection = element<HTMLSpanElement>('connection');
const saveForm = element<HTMLFormElement>('save-form');
const labelInput = element<HTMLInputElement>('version-label');
const saveButton = element<HTMLButtonElement>('save-version');
const compareForm = element<HTMLFormElement>('compare-form');
const compareFrom = element<HTMLSelectElement>('compare-from');
const compareTo = element<HTMLSelectElement>('compare-to');
const compareButton = element<HTMLButtonElement>('compare');
const status = element<HTMLParagraphElement>('status');
const versionList = element<HTMLOListElement>('versions');

const params = new URLSearchParams(window.location.search);
const userName = params.get('user') ?? 'Ann';
const serverPort = 1250 + Number(import.meta.env.VITE_SUPERDOC_EXAMPLE_PORT_OFFSET ?? '0');
const serverUrl = import.meta.env.VITE_COLLABORATION_URL ?? `ws://${window.location.hostname}:${serverPort}`;
userLabel.textContent = `Signed in as ${userName}`;

let knownHead: string | null = null;
let versions: VersionRecord[] = [];
let busy = false;
let connected = false;

const superdoc = new SuperDoc({
  selector: '#editor',
  documents: [
    {
      id: DOCUMENT_ID,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: await api.source(),
      collaboration: { providerType: 'hocuspocus', documentId: DOCUMENT_ID, serverUrl, roomMode: 'join' },
    },
  ],
  user: { name: userName, email: `${userName.toLowerCase().replaceAll(' ', '-')}@example.com` },
  onCollaborationReady: () => {
    connected = true;
    connection.textContent = 'Connected.';
    render();
  },
  onCollaborationConnectionChange: ({ state, kind }) => {
    connected = state === 'synced';
    connection.textContent =
      kind === 'lost' || kind === 'reconnecting'
        ? 'Offline. Your edits are kept in this tab and sent when the connection returns.'
        : kind === 'recovered'
          ? 'Reconnected.'
          : kind === 'failed'
            ? 'Connection failed. Copy any unsaved work before closing this tab.'
            : connected
              ? 'Connected.'
              : 'Connecting...';
    render();
  },
  onException: (payload) => {
    if ('diagnosticCode' in payload) return console.warn('[SuperDoc diagnostic]', payload.diagnosticCode, payload.message);
    console.error(payload.error);
  },
});

const describe = (version: VersionRecord) =>
  `${version.id} · ${version.label}${version.restoredFrom ? ` (from ${version.restoredFrom})` : ''}`;

const option = (version: VersionRecord) => new Option(describe(version), version.id);

function render() {
  const disabled = busy || !connected;
  saveButton.disabled = disabled;
  compareButton.disabled = busy || versions.length < 2;

  const from = compareFrom.value;
  const to = compareTo.value;
  compareFrom.replaceChildren(...versions.map(option));
  compareTo.replaceChildren(...versions.map(option));
  compareFrom.value = versions.some((version) => version.id === from) ? from : (versions.at(-2)?.id ?? '');
  compareTo.value = versions.some((version) => version.id === to) ? to : (versions.at(-1)?.id ?? '');

  versionList.replaceChildren(
    ...[...versions].reverse().map((version) => {
      const item = document.createElement('li');
      item.dataset.versionId = version.id;
      const title = document.createElement('span');
      title.textContent = describe(version);
      if (version.id === knownHead) title.className = 'head';
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${version.createdBy} · ${version.trigger} · ${new Date(version.createdAt).toLocaleString()}`;
      const download = document.createElement('a');
      download.href = `/api/documents/${encodeURIComponent(DOCUMENT_ID)}/versions/${version.id}/content`;
      download.textContent = 'Download';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.textContent = `Restore ${version.id}`;
      restore.disabled = disabled || version.id === knownHead;
      restore.addEventListener('click', () => void restoreVersion(version.id));
      item.append(title, meta, download, ' ', restore);
      return item;
    }),
  );
}

async function refresh() {
  const list = await api.list();
  versions = list.versions;
  knownHead = list.head;
  render();
}

async function run(message: string, work: () => Promise<string>) {
  if (busy) return;
  busy = true;
  status.textContent = message;
  render();
  try {
    status.textContent = await work();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    if (!(error instanceof ApiError)) console.error(error);
  } finally {
    busy = false;
    await refresh().catch(() => {});
  }
}

async function restoreVersion(versionId: string) {
  await run(`Restoring ${versionId}...`, async () => {
    try {
      const { before, restored } = await api.restore(versionId, knownHead, userName);
      return `Restored ${versionId} as ${restored.id}. The previous state is kept as ${before.id}.`;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        return error.body.reason === 'stale-base'
          ? `Someone saved a newer version. The list is refreshed; review it and restore again.`
          : `The document changed while restoring, so nothing was restored. Try again.`;
      }
      throw error;
    }
  });
}

saveForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const label = labelInput.value.trim();
  if (!label) return;
  void run('Saving version...', async () => {
    const saved = await api.save(label, userName);
    labelInput.value = '';
    return `Saved ${saved.id}.`;
  });
});

compareForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const url = new URL('/compare.html', window.location.href);
  url.searchParams.set('doc', DOCUMENT_ID);
  url.searchParams.set('from', compareFrom.value);
  url.searchParams.set('to', compareTo.value);
  window.open(url.href, '_blank', 'noopener');
});

window.versionHistoryExample = { superdoc, refresh };
window.addEventListener('pagehide', () => superdoc.destroy());
await refresh();
setInterval(() => void refresh().catch(() => {}), 3_000);
