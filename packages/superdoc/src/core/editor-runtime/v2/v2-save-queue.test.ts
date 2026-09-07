import { describe, expect, it, vi } from 'vite-plus/test';
import { createV2SaveQueue } from './v2-save-queue.js';

describe('V2 shell save queue', () => {
  it('starts idle saves synchronously and queues overlapping export options', async () => {
    let finishSave!: (value: ArrayBuffer) => void;
    const saved = new ArrayBuffer(1);
    const exported = new ArrayBuffer(2);
    const hostSave = vi
      .fn<(options?: { commentExportMode?: string }) => Promise<ArrayBuffer>>()
      .mockImplementationOnce(() => new Promise((resolve) => (finishSave = resolve)))
      .mockResolvedValue(exported);
    const save = createV2SaveQueue(hostSave);

    const first = save();
    const second = save({ commentExportMode: 'strip' });
    expect(hostSave).toHaveBeenCalledExactlyOnceWith(undefined);

    finishSave(saved);
    await expect(first).resolves.toBe(saved);
    await expect(second).resolves.toBe(exported);
    expect(hostSave).toHaveBeenNthCalledWith(2, { commentExportMode: 'strip' });
    const third = save();
    expect(hostSave).toHaveBeenCalledTimes(3);
    await expect(third).resolves.toBe(exported);
  });

  it('propagates a failed save and still runs the next request', async () => {
    const failure = new Error('collaboration save barrier failed');
    const bytes = new ArrayBuffer(1);
    const hostSave = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(bytes);
    const save = createV2SaveQueue(hostSave);

    const first = save();
    const second = save();

    await expect(first).rejects.toBe(failure);
    await expect(second).resolves.toBe(bytes);
    expect(hostSave).toHaveBeenCalledTimes(2);
  });
});
