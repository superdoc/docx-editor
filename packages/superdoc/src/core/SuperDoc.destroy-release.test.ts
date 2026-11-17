/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { getActivePinia } from 'pinia';
import { getCommentsLayoutBridge } from '../helpers/comment-small-screen.js';

vi.mock('./v2-integration/v2-integration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./v2-integration/v2-integration.js')>()),
  loadDefaultV2IntegrationOrFallback: () => Promise.resolve(),
}));

const { SuperDoc } = await import('./SuperDoc.js');

afterEach(() => {
  document.body.innerHTML = '';
});

function createSuperDoc() {
  const selector = document.createElement('div');
  document.body.append(selector);
  const blank = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../shared/common/data/blank.docx'),
  );
  const document_ = new File([blank], 'blank.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  return new SuperDoc({ selector, document: document_, telemetry: { enabled: false } });
}

it('releases the comments layout bridge on destroy, whose closures would otherwise keep the SuperDoc alive', () => {
  const superdoc = createSuperDoc();
  expect(getCommentsLayoutBridge(superdoc)).toBeDefined();

  superdoc.destroy();

  expect(getCommentsLayoutBridge(superdoc)).toBeUndefined();
});

it('releases its Pinia on destroy, so the module-level active Pinia no longer reaches the destroyed app', async () => {
  const superdoc = createSuperDoc();
  await vi.waitFor(() => expect(superdoc.pinia).toBeDefined());
  expect(getActivePinia()).toBe(superdoc.pinia);

  superdoc.destroy();

  expect(getActivePinia()).toBeUndefined();
  expect(superdoc.pinia).toBeUndefined();
});
