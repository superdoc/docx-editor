import { describe, expect, it, vi } from 'vite-plus/test';
import { executeDelete, type DeleteInput } from './delete.js';
import type { SelectionMutationAdapter } from '../selection-mutation.js';

describe('executeDelete input options', () => {
  it('guides misplaced changeMode to the second argument before mutation', () => {
    const adapter = { execute: vi.fn() } as unknown as SelectionMutationAdapter;
    expect(() =>
      executeDelete(adapter, {
        ref: 'existing-ref',
        changeMode: 'tracked',
      } as unknown as DeleteInput),
    ).toThrow('doc.delete(input, { changeMode: "tracked" })');
    expect(adapter.execute).not.toHaveBeenCalled();
  });
});
