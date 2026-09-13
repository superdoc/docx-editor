import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createFakeV2Runtime } from './editor-runtime/conformance/fake-v2-runtime.js';
import type { EditorRuntime } from './editor-runtime/index.js';
import { __resetDeprecationWarnings } from './helpers/normalize-track-changes-config.js';
import type { Config, RuntimeDocument } from './types/index.js';

vi.mock('./v2-integration/v2-integration.js', () => ({
  loadDefaultV2IntegrationOrFallback: () => new Promise(() => {}),
}));

const { SuperDoc } = await import('./SuperDoc.js');
type SuperDocInstance = InstanceType<typeof SuperDoc>;

interface SuperDocTestHarness {
  commentsStore?: {
    clearEditorCommentPositions?: () => void;
    setViewingVisibility?: (options: {
      documentMode?: string;
      commentsVisible?: boolean;
      trackChangesVisible?: boolean;
    }) => void;
  };
  registerEditorRuntime(runtime: EditorRuntime): void;
  superdocStore?: { documents: RuntimeDocument[] };
}

const instances: SuperDocInstance[] = [];

function mount(config: Partial<Config> = {}): SuperDocInstance {
  const selector = document.createElement('div');
  document.body.append(selector);
  const instance = new SuperDoc({ selector, telemetry: { enabled: false }, ...config });
  instances.push(instance);
  return instance;
}

function makeRuntime(documentId: string, id = `${documentId}-runtime`) {
  const runtime = createFakeV2Runtime({ id, documentId, initialDocumentMode: 'viewing' });
  const setTrackedChangesRenderOptions = vi.fn<EditorRuntime['setTrackedChangesRenderOptions']>();
  runtime.setTrackedChangesRenderOptions = setTrackedChangesRenderOptions;
  return { runtime, setTrackedChangesRenderOptions };
}

function makeReady(instance: SuperDocInstance, documents: RuntimeDocument[]) {
  const harness = instance as unknown as SuperDocTestHarness;
  const setViewingVisibility = vi.fn();
  const clearEditorCommentPositions = vi.fn();
  harness.superdocStore = { documents };
  harness.commentsStore = { setViewingVisibility, clearEditorCommentPositions };
  return { harness, setViewingVisibility, clearEditorCommentPositions };
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('viewing options', () => {
  it('normalizes the canonical startup config for the mounted renderer', () => {
    const instance = mount({
      documentMode: 'viewing',
      viewing: { comments: true, trackedChanges: 'final' },
    });

    expect(instance.config.viewing).toEqual({ comments: true, trackedChanges: 'final' });
    expect(instance.config.comments).toEqual({ visible: true });
    expect(instance.config.modules.trackChanges).toMatchObject({ visible: false, mode: 'final', enabled: true });
  });

  it('does not mutate or warn when one canonical config mounts more than once', () => {
    __resetDeprecationWarnings();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sharedConfig = {
      viewing: { trackedChanges: 'final' as const },
      modules: {},
    };

    mount(sharedConfig);
    mount(sharedConfig);

    expect(sharedConfig.modules).toEqual({});
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('keeps future viewing options dormant while the document is editable', () => {
    const instance = mount({
      documentMode: 'editing',
      viewing: { comments: true, trackedChanges: 'final' },
    });

    expect(instance.config.viewing).toEqual({ comments: true, trackedChanges: 'final' });
    expect(instance.config.modules.trackChanges).toMatchObject({ mode: 'review', enabled: true });
  });

  it('keeps the deprecated v2 config working', () => {
    const instance = mount({
      documentMode: 'viewing',
      comments: { visible: true },
      modules: { trackChanges: { visible: true, mode: 'review' } },
    });

    expect(instance.config.comments).toEqual({ visible: true });
    expect(instance.config.modules.trackChanges).toMatchObject({ visible: true, mode: 'review', enabled: true });
  });

  it.each([
    {
      name: 'module mode',
      config: { modules: { trackChanges: { mode: 'final' as const } } },
      expectedMode: 'final',
    },
    {
      name: 'layout override',
      config: { layoutEngineOptions: { trackedChanges: { mode: 'off' as const } } },
      expectedMode: 'off',
    },
  ])('preserves the deprecated $name in a mounted viewer', ({ config, expectedMode }) => {
    const documentEntry = { id: 'doc-1' } as RuntimeDocument;
    const instance = mount({ documentMode: 'viewing', ...config });
    const { harness } = makeReady(instance, [documentEntry]);
    const { runtime, setTrackedChangesRenderOptions } = makeRuntime('doc-1');
    harness.registerEditorRuntime(runtime);

    instance.setDocumentMode('viewing');

    expect(setTrackedChangesRenderOptions).toHaveBeenCalledWith({ mode: expectedMode, enabled: true });
  });

  it('preserves legacy comment policy while canonical viewing controls visibility', () => {
    const instance = mount({
      documentMode: 'viewing',
      viewing: { comments: true },
      comments: { visible: false, readOnly: true },
    } as Partial<Config>);

    expect(instance.config.comments).toEqual({ visible: true, readOnly: true });
  });

  it('applies canonical viewing options after a live mode switch', () => {
    const restoreComments = vi.fn();
    const documentEntry = { id: 'doc-1', restoreComments } as RuntimeDocument;
    const instance = mount({
      documentMode: 'editing',
      viewing: { comments: true, trackedChanges: 'final' },
    });
    const { harness } = makeReady(instance, [documentEntry]);
    const { runtime, setTrackedChangesRenderOptions } = makeRuntime('doc-1');
    harness.registerEditorRuntime(runtime);

    instance.setDocumentMode('viewing');

    expect(setTrackedChangesRenderOptions).toHaveBeenCalledWith({ mode: 'final', enabled: true });
    expect(restoreComments).toHaveBeenCalledOnce();
  });

  it('uses the default viewing projection after a live mode switch', () => {
    const documentEntry = { id: 'doc-1' } as RuntimeDocument;
    const instance = mount({ documentMode: 'editing' });
    const { harness } = makeReady(instance, [documentEntry]);
    const { runtime, setTrackedChangesRenderOptions } = makeRuntime('doc-1');
    harness.registerEditorRuntime(runtime);

    expect(instance.config.modules.trackChanges).toMatchObject({ mode: 'review', enabled: true });

    instance.setDocumentMode('viewing');

    expect(setTrackedChangesRenderOptions).toHaveBeenCalledWith({ mode: 'original', enabled: true });
  });

  it('updates one viewing option without resetting the other', () => {
    const restoreComments = vi.fn();
    const documentEntry = { id: 'doc-1', restoreComments } as RuntimeDocument;
    const instance = mount({
      documentMode: 'viewing',
      viewing: { comments: false, trackedChanges: 'final' },
    });
    const { harness, setViewingVisibility } = makeReady(instance, [documentEntry]);
    const { runtime, setTrackedChangesRenderOptions } = makeRuntime('doc-1');
    harness.registerEditorRuntime(runtime);

    instance.setViewingOptions({ comments: true });

    expect(instance.config.viewing).toEqual({ comments: true, trackedChanges: 'final' });
    expect(setTrackedChangesRenderOptions).not.toHaveBeenCalled();
    expect(setViewingVisibility).toHaveBeenLastCalledWith({
      documentMode: 'viewing',
      commentsVisible: true,
      trackChangesVisible: false,
    });
    expect(restoreComments).toHaveBeenCalledOnce();

    instance.setViewingOptions({ trackedChanges: 'markup' });

    expect(instance.config.viewing).toEqual({ comments: true, trackedChanges: 'markup' });
    expect(setTrackedChangesRenderOptions).toHaveBeenCalledWith({ mode: 'review', enabled: true });
  });

  it('keeps legacy comment policy during live visibility updates', () => {
    const instance = mount({
      documentMode: 'viewing',
      comments: { visible: false, readOnly: true },
    } as Partial<Config>);
    makeReady(instance, []);

    instance.setViewingOptions({ comments: true });

    expect(instance.config.comments).toEqual({ visible: true, readOnly: true });
  });

  it('preserves the track-changes behavior setting during live projection updates', () => {
    const documentEntry = { id: 'doc-1' } as RuntimeDocument;
    const instance = mount({
      documentMode: 'viewing',
      modules: { trackChanges: { enabled: false } },
    });
    const { harness } = makeReady(instance, [documentEntry]);
    const { runtime, setTrackedChangesRenderOptions } = makeRuntime('doc-1');
    harness.registerEditorRuntime(runtime);

    instance.setViewingOptions({ trackedChanges: 'markup' });

    expect(instance.config.modules.trackChanges?.enabled).toBe(false);
    expect(setTrackedChangesRenderOptions).toHaveBeenCalledWith({ mode: 'review', enabled: false });
  });

  it('preserves a compatibility-setter disable during live projection updates', () => {
    const documentEntry = { id: 'doc-1' } as RuntimeDocument;
    const instance = mount({
      documentMode: 'viewing',
      viewing: { trackedChanges: 'original' },
    });
    const { harness } = makeReady(instance, [documentEntry]);
    const { runtime, setTrackedChangesRenderOptions } = makeRuntime('doc-1');
    harness.registerEditorRuntime(runtime);

    instance.setTrackedChangesPreferences({ enabled: false });
    setTrackedChangesRenderOptions.mockClear();
    instance.setViewingOptions({ trackedChanges: 'final' });

    expect(instance.config.modules.trackChanges?.enabled).toBe(false);
    expect(instance.config.trackChanges?.enabled).toBe(false);
    expect(setTrackedChangesRenderOptions).toHaveBeenCalledWith({ mode: 'final', enabled: false });
  });

  it('keeps live viewing options active after a viewer requests editing', () => {
    const documentEntry = { id: 'doc-1' } as RuntimeDocument;
    const instance = mount({
      role: 'viewer',
      documentMode: 'viewing',
      viewing: { trackedChanges: 'original' },
    });
    const { harness } = makeReady(instance, [documentEntry]);
    const { runtime, setTrackedChangesRenderOptions } = makeRuntime('doc-1');
    harness.registerEditorRuntime(runtime);

    instance.setDocumentMode('editing');
    setTrackedChangesRenderOptions.mockClear();
    instance.setViewingOptions({ trackedChanges: 'final' });

    expect(instance.config.documentMode).toBe('viewing');
    expect(setTrackedChangesRenderOptions).toHaveBeenCalledWith({ mode: 'final', enabled: true });
  });

  it('preserves hidden comments across projection-only viewing updates', () => {
    let conversations = ['comment-1'];
    let conversationsBackup: string[] = [];
    const removeComments = vi.fn(() => {
      conversationsBackup = conversations;
      conversations = [];
    });
    const restoreComments = vi.fn(() => {
      conversations = conversationsBackup;
    });
    const documentEntry = { id: 'doc-1', removeComments, restoreComments } as RuntimeDocument;
    const instance = mount({
      documentMode: 'viewing',
      viewing: { comments: false, trackedChanges: 'original' },
    });
    const { harness } = makeReady(instance, [documentEntry]);
    const { runtime } = makeRuntime('doc-1');
    harness.registerEditorRuntime(runtime);

    instance.setDocumentMode('viewing');
    instance.setViewingOptions({ trackedChanges: 'final' });
    instance.setViewingOptions({ comments: true });

    expect(removeComments).toHaveBeenCalledOnce();
    expect(restoreComments).toHaveBeenCalledOnce();
    expect(conversations).toEqual(['comment-1']);
  });

  it('routes the deprecated setter to every mounted v2 runtime and the compatibility fallback', () => {
    const fallback = vi.fn();
    const documents = [
      { id: 'doc-a', getDocumentRuntime: () => ({ setTrackedChangesOverrides: fallback }) },
      { id: 'doc-b', getDocumentRuntime: () => ({ setTrackedChangesOverrides: fallback }) },
    ] as RuntimeDocument[];
    const instance = mount();
    const { harness } = makeReady(instance, documents);
    const first = makeRuntime('doc-a', 'runtime-a-1');
    const second = makeRuntime('doc-a', 'runtime-a-2');
    harness.registerEditorRuntime(first.runtime);
    harness.registerEditorRuntime(second.runtime);

    instance.setTrackedChangesPreferences({ mode: 'off', enabled: false });

    expect(first.setTrackedChangesRenderOptions).toHaveBeenCalledWith({ mode: 'off', enabled: false });
    expect(second.setTrackedChangesRenderOptions).toHaveBeenCalledWith({ mode: 'off', enabled: false });
    expect(fallback).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith({ mode: 'off', enabled: false });
  });
});
