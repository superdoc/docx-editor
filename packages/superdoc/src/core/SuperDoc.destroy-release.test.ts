/** @vitest-environment jsdom */

import { afterEach, expect, it, vi } from 'vite-plus/test';
import { getCommentsLayoutBridge } from '../helpers/comment-small-screen.js';

vi.mock('./v2-integration/v2-integration.js', () => ({
  loadDefaultV2IntegrationOrFallback: () => new Promise(() => {}),
}));

const { SuperDoc } = await import('./SuperDoc.js');

afterEach(() => {
  document.body.innerHTML = '';
});

it('releases the comments layout bridge on destroy, whose closures would otherwise keep the SuperDoc alive', () => {
  const selector = document.createElement('div');
  document.body.append(selector);
  const superdoc = new SuperDoc({ selector, telemetry: { enabled: false } });
  expect(getCommentsLayoutBridge(superdoc)).toBeDefined();

  superdoc.destroy();

  expect(getCommentsLayoutBridge(superdoc)).toBeUndefined();
});
