import { describe, expect, it, vi } from 'vite-plus/test';
import { createSuperDocUI } from './create-super-doc-ui.js';

type HighlightActions = {
  highlight?: (input: unknown) => unknown;
  clearHighlight?: () => unknown;
};

describe('SD-4913 content-control highlight failure boundaries', () => {
  for (const input of [undefined, null, {}, { id: '' }, { id: ' ' }, { id: 42 }]) {
    it(`rejects ${JSON.stringify(input)} without navigation or writes`, async () => {
      const execute = vi.fn();
      const setTextSelection = vi.fn();
      const scrollIntoView = vi.fn();
      const focus = vi.fn();
      const ui = createSuperDocUI({
        superdoc: {
          activeEditor: {
            editorVersion: 2,
            commands: { execute, setTextSelection, scrollIntoView, focus },
          },
        } as never,
      });
      try {
        const actions = ui.contentControls as unknown as HighlightActions;
        const result = await actions.highlight?.(input);
        expect.soft(result).toEqual(expect.objectContaining({ success: false }));
        for (const call of [execute, setTextSelection, scrollIntoView, focus]) expect(call).not.toHaveBeenCalled();
      } finally {
        ui.destroy();
      }
    });
  }

  it('reports an unavailable editor and makes clearing safe before ready and after disposal', async () => {
    const ui = createSuperDocUI({ superdoc: { activeEditor: null } as never });
    const actions = ui.contentControls as unknown as HighlightActions;
    expect.soft(await actions.highlight?.({ id: 'valid-id' })).toEqual(expect.objectContaining({ success: false }));
    expect.soft(typeof actions.clearHighlight).toBe('function');
    await actions.clearHighlight?.();
    await actions.clearHighlight?.();
    ui.destroy();
    expect.soft(await actions.highlight?.({ id: 'valid-id' })).toEqual(expect.objectContaining({ success: false }));
    await actions.clearHighlight?.();
  });
});
