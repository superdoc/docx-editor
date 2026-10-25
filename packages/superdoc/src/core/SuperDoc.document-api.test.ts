/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { SuperDoc } from './SuperDoc.js';
import type { Editor } from './types/index.js';

const instances: SuperDoc[] = [];
function create() {
  const selector = document.createElement('div');
  document.body.append(selector);
  const instance = new SuperDoc({ selector, telemetry: { enabled: false } });
  instances.push(instance);
  return instance;
}
afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.replaceChildren();
});

describe('SuperDoc.getDocumentApi', () => {
  it("is the active editor's API until the instance is destroyed, and says when that ends", () => {
    const instance = create();
    const doc = { name: 'document api' };
    expect(instance.getDocumentApi()).toBeNull();
    instance.setActiveEditor({ editorVersion: 2, doc } as unknown as Editor);
    expect(instance.getDocumentApi()).toBe(doc);

    const apiWhenNotified: unknown[] = [];
    instance.on('active-editor-change', () => apiWhenNotified.push(instance.getDocumentApi()));
    instance.destroy();

    expect(apiWhenNotified).toEqual([null]);
    expect(instance.activeEditor).toBeNull();
  });
});
