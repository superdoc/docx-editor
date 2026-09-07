/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { DOCX, PDF } from '@superdoc/common';
import { SuperDoc } from './SuperDoc.js';

const instances: SuperDoc[] = [];

function createInstance(documents: unknown[]): SuperDoc {
  const selector = document.createElement('div');
  document.body.append(selector);
  const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
  instances.push(instance);
  (instance as unknown as { superdocStore: { documents: unknown[] } }).superdocStore = { documents };
  return instance;
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SuperDoc.save', () => {
  it('waits for the mounted editor save and keeps the void return contract', async () => {
    let finishSave!: (value: ArrayBuffer) => void;
    const editor = {
      editorVersion: 2,
      save: vi.fn(() => new Promise<ArrayBuffer>((resolve) => (finishSave = resolve))),
    };
    const instance = createInstance([{ id: 'docx', type: DOCX, getEditor: () => editor }]);
    const settled = vi.fn();

    const saving = instance.save().then(settled);
    await Promise.resolve();
    expect(editor.save).toHaveBeenCalledOnce();
    expect(settled).not.toHaveBeenCalled();

    finishSave(new ArrayBuffer(1));
    await saving;
    expect(settled).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('propagates the editor save failure', async () => {
    const failure = new Error('collaboration save barrier failed');
    const editor = { editorVersion: 2, save: vi.fn().mockRejectedValue(failure) };
    const instance = createInstance([{ id: 'docx', type: DOCX, getEditor: () => editor }]);

    await expect(instance.save()).rejects.toBe(failure);
  });

  it('rejects when the DOCX editor is unavailable', async () => {
    const instance = createInstance([{ id: 'not-ready', type: DOCX, getEditor: () => null }]);

    await expect(instance.save()).rejects.toThrow('SuperDoc: save is unavailable for document "not-ready"');
  });

  it('finishes when there are no DOCX editors to save', async () => {
    const instance = createInstance([{ id: 'pdf', type: PDF }]);

    await expect(instance.save()).resolves.toBeUndefined();
  });
});
