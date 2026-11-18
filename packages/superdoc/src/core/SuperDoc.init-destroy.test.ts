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
  it('reads and changes comments layout before the editor mounts', () => {
    const selector = document.createElement('div');
    document.body.append(selector);
    const instance = new SuperDoc({
      selector,
      telemetry: { enabled: false },
      modules: { comments: { layout: 'sidebar' } },
      ui: { comments: { layout: 'inline' } },
    });
    instances.push(instance);
    const events: Array<{ requested: string; effective: string }> = [];
    const onLayoutChange = (layout: { requested: string; effective: string }) => events.push(layout);
    instance.on('comments-layout-change', onLayoutChange);
    expect(instance.getCommentsLayout()).toEqual({ requested: 'inline', effective: 'inline' });
    expect(Object.isFrozen(instance.getCommentsLayout())).toBe(true);
    expect(instance.ui.comments.getSnapshot().layout).toEqual(instance.getCommentsLayout());
    instance.ui.comments.setLayout('auto');
    instance.setCommentsLayout('auto');
    expect(instance.getCommentsLayout()).toEqual({ requested: 'auto', effective: 'inline' });
    expect(events).toEqual([{ requested: 'auto', effective: 'inline' }]);
    expect(() => Reflect.apply(instance.setCommentsLayout, instance, ['bogus'])).toThrow(RangeError);
    expect(instance.getCommentsLayout()).toEqual({ requested: 'auto', effective: 'inline' });
    instance.off('comments-layout-change', onLayoutChange);
    instance.setCommentsLayout('sidebar');
    expect(events).toEqual([{ requested: 'auto', effective: 'inline' }]);
  });

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
