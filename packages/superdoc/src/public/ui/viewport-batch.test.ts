import { describe, expect, it, vi } from 'vite-plus/test';
import { createSuperDocUI } from './create-super-doc-ui.js';

type TextTarget = { kind: 'text'; blockId: string; range: { start: number; end: number } };

function paintedRect(left: number, top: number) {
  return { left, right: left + 8, top, bottom: top + 14, width: 8, height: 14 };
}

function paintedRects({ target }: { target: TextTarget }) {
  const block = Number(target.blockId.slice(1));
  const offset = target.range.start;
  if (offset % 7 === 3) return { success: false, reason: 'not-mounted' };
  if (offset % 11 === 5) {
    return { success: true, rects: [paintedRect(400 + block, offset * 20), paintedRect(10, offset * 20 + 14)] };
  }
  return { success: true, rects: [paintedRect(10 + block, offset * 20)] };
}

function harness() {
  let generation = 1;
  const host = {
    getPageMetricsSnapshot: () => ({ documentId: 'doc', layoutGeneration: generation, renderEpoch: generation }),
    getLocalMutationRevision: () => generation,
    getTargetRects: vi.fn(paintedRects),
  };
  const superdoc = { activeEditor: { id: 'one', editorVersion: 2, host, editCommands: {} }, on() {}, off() {} };
  const ui = createSuperDocUI({ superdoc });
  return {
    ui,
    host,
    superdoc,
    change: () => {
      generation++;
    },
  };
}
const target = { kind: 'text' as const, blockId: 'p0', range: { start: 0, end: 1 } };

describe('batch viewport geometry', () => {
  it('returns one row per target in request order and yields to input', async () => {
    const h = harness();
    const targets: TextTarget[] = Array.from({ length: 70 }, (_, index) => ({
      kind: 'text',
      blockId: `p${(index * 37) % 70}`,
      range: { start: (index * 53) % 70, end: ((index * 53) % 70) + 1 },
    }));
    let inputRan = false;
    const pending = h.ui.viewport.getRects({ targets });
    setTimeout(() => {
      inputRan = true;
    }, 0);
    const result = await pending;
    expect(inputRan).toBe(true);
    expect(result.status).toBe('complete');
    const rows = result.results.map((row, index) => {
      const requested = targets[index];
      const label = requested ? `${requested.blockId} @${requested.range.start}` : 'extra row';
      return `${label} -> ${JSON.stringify(row)}`;
    });
    await expect(`${rows.join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/viewport-batch/rows-in-request-order.txt',
    );
    h.ui.destroy();
  });
  it.each(['metrics', 'observation', 'cleanup'] as const)('handles a failing host %s hook', async (hook) => {
    const h = harness();
    const fail = () => {
      throw new Error('retired host');
    };
    if (hook === 'metrics') h.host.getPageMetricsSnapshot = fail;
    Object.assign(h.host, { observeGeometry: hook === 'observation' ? fail : () => fail });
    const result = await h.ui.viewport.getRects({ targets: [target] });
    expect(result.status).toBe(hook === 'cleanup' ? 'complete' : 'stale');
    h.ui.destroy();
  });
  it.each(['mutation', 'replacement', 'dispose', 'cancel'] as const)(
    'invalidates the entire request after %s',
    async (action) => {
      const h = harness();
      const controller = new AbortController();
      const pending = h.ui.viewport.getRects({
        targets: Array.from({ length: 500 }, () => target),
        signal: controller.signal,
      });
      if (action === 'mutation') h.change();
      if (action === 'replacement') h.superdoc.activeEditor = { ...h.superdoc.activeEditor, id: 'two' };
      if (action === 'dispose') h.ui.destroy();
      if (action === 'cancel') controller.abort();
      const result = await pending;
      expect(result.status).toBe(action === 'dispose' ? 'disposed' : action === 'cancel' ? 'cancelled' : 'stale');
      expect(result.results).toHaveLength(500);
      expect(result.results.every((row) => !row.found)).toBe(true);
      h.ui.destroy();
    },
  );
});
