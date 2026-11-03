/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Comment, Config, Editor } from './types/index.js';

vi.mock('./v2-integration/v2-integration.js', () => ({
  loadDefaultV2IntegrationOrFallback: () => new Promise(() => {}),
}));

const { SuperDoc } = await import('./SuperDoc.js');

const instances: InstanceType<typeof SuperDoc>[] = [];

const consumerOnlyFields = [
  'superdocId',
  'format',
  'toolbar',
  'permissionResolver',
  'onFontsResolved',
  'handleImageUpload',
  'onTrackedChangeBubbleAccept',
  'onTrackedChangeBubbleReject',
] as const satisfies readonly (keyof Config)[];

function mount(config: Omit<Config, 'selector'> = {}) {
  const selector = document.createElement('div');
  document.body.append(selector);
  const instance = new SuperDoc({ selector, telemetry: { enabled: false }, ...config });
  instances.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
});

describe('optional consumer config', () => {
  it.each(consumerOnlyFields)('leaves %s undefined when the consumer omits it', (field) => {
    expect(mount().config[field]).toBeUndefined();
  });

  it('keeps the tracked-change bubble callbacks the consumer passes', () => {
    const onTrackedChangeBubbleAccept = vi.fn<(comment: Comment, editor: Editor | null) => void>();
    const onTrackedChangeBubbleReject = vi.fn<(comment: Comment, editor: Editor | null) => void>();

    const { config } = mount({ onTrackedChangeBubbleAccept, onTrackedChangeBubbleReject });

    expect(config.onTrackedChangeBubbleAccept).toBe(onTrackedChangeBubbleAccept);
    expect(config.onTrackedChangeBubbleReject).toBe(onTrackedChangeBubbleReject);
  });
});
