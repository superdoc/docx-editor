// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vite-plus/test';

type Listener = (payload?: unknown) => void;
type SuperDocConfig = {
  onReady?: Listener;
  onEditorUpdate?: Listener;
};

const instances: FakeSuperDoc[] = [];

class FakeSuperDoc {
  readonly listeners = new Map<string, Listener[]>();
  readonly activeEditor = { editorVersion: 2, doc: { getHtml: () => '<p>hello</p>' } };
  readonly export = vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])]));
  readonly destroy = vi.fn();

  constructor(readonly config: SuperDocConfig) {
    if (config.onEditorUpdate) this.on('editor-update', config.onEditorUpdate);
    instances.push(this);
  }

  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

vi.mock('superdoc', () => ({ SuperDoc: FakeSuperDoc }));

const WEBVIEW_ORIGIN = 'vscode-webview://test';
const postMessage = vi.fn();

function postedTypes(): string[] {
  return postMessage.mock.calls.map(([message]) => message.type);
}

async function openDocument(): Promise<FakeSuperDoc> {
  window.dispatchEvent(
    new MessageEvent('message', { origin: WEBVIEW_ORIGIN, data: { type: 'update', content: { data: [80, 75] } } }),
  );
  const superdoc = instances.at(-1);
  if (!superdoc) throw new Error('webview did not create SuperDoc');
  return superdoc;
}

describe('webview autosave', () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="superdoc-toolbar"></div><div id="superdoc"></div>';
    vi.stubGlobal('origin', WEBVIEW_ORIGIN);
    vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage }));
    await import('../webview/main.js');
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    instances.length = 0;
    postMessage.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves the document after a SuperDoc editor-update', async () => {
    const superdoc = await openDocument();
    superdoc.config.onReady?.();

    superdoc.emit('editor-update', { editor: superdoc.activeEditor, surface: 'body' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(superdoc.export).toHaveBeenCalledWith({ format: 'docx' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'update', content: [1, 2, 3] });
  });

  it('saves once for a burst of editor-updates', async () => {
    const superdoc = await openDocument();
    superdoc.config.onReady?.();

    for (let edit = 0; edit < 3; edit += 1) {
      superdoc.emit('editor-update', { editor: superdoc.activeEditor, surface: 'body' });
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(1000);

    expect(superdoc.export).toHaveBeenCalledTimes(1);
    expect(postedTypes().filter((type) => type === 'update')).toHaveLength(1);
  });

  it('does not save for updates before SuperDoc is ready', async () => {
    const superdoc = await openDocument();

    superdoc.emit('editor-update', { editor: superdoc.activeEditor, surface: 'body' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(superdoc.export).not.toHaveBeenCalled();
    expect(postedTypes()).not.toContain('update');
  });
});
