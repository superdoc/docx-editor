/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

let finishEngineLoad = () => {};
const engineLoad = new Promise<void>((resolve) => {
  finishEngineLoad = resolve;
});

vi.mock('./v2-integration/v2-integration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./v2-integration/v2-integration.js')>()),
  loadDefaultV2IntegrationOrFallback: () => engineLoad,
}));

const { SuperDoc } = await import('./SuperDoc.js');

const instances: InstanceType<typeof SuperDoc>[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SuperDoc destroyed while init awaits collaboration', () => {
  it('never mounts and releases the collaboration provider once init resumes', async () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const instance = new SuperDoc({
      selector,
      telemetry: { enabled: false },
      modules: { collaboration: { providerType: 'superdoc', url: 'wss://collaboration.test' } },
    });
    instances.push(instance);
    const providerAttachedDuringInit = { disconnect: vi.fn(), destroy: vi.fn() };

    const destroyedDuringCollaborationInit = engineLoad.then(() => {
      instance.destroy();
      instance.provider = providerAttachedDuringInit;
    });
    finishEngineLoad();
    await destroyedDuringCollaborationInit;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(selector.childNodes).toHaveLength(0);
    expect(() => instance.state).toThrow('SuperDoc: state requires the instance to be ready');
    expect(providerAttachedDuringInit.disconnect).toHaveBeenCalledTimes(1);
    expect(providerAttachedDuringInit.destroy).toHaveBeenCalledTimes(1);
  });
});
